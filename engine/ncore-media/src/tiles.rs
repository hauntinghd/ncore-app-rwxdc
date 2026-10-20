//! Content-addressed screen tile codec.
//!
//! ## Model
//! A frame is BGRA8, row-major. It is divided into `TILE`×`TILE` tiles (edge
//! tiles may be smaller). Each tile is identified by `xxh3_64` of its pixels.
//!
//! Per frame the encoder emits an [`Update`]:
//! - an optional [`Scroll`] — a vertical shift of the whole frame, detected
//!   by matching row hashes between the previous and current frame. Both
//!   sides apply the identical shift to their reference;
//! - for a scroll, a [`TileOp::Strip`] carrying exactly the newly exposed
//!   rows (an 8 px scroll costs 8 rows, not a 64 px row of tiles);
//! - one [`TileOp`] per tile whose content changed vs the (shifted)
//!   reference: [`TileOp::Ref`] if the receiver's cache already holds a tile
//!   with that hash (8-byte reference instead of pixels), else
//!   [`TileOp::Data`] carrying the tile losslessly compressed.
//!
//! Unchanged tiles cost nothing. A static screen costs ~18 bytes per frame.
//!
//! ## Cache coherence
//! Encoder and decoder each keep a FIFO set of tile hashes with the same
//! capacity and the same insertion order (only `Data` inserts; `Ref` never
//! reorders), so the encoder's view of "what the receiver holds" is exact
//! without any acknowledgement traffic.
//!
//! ## Compression
//! Pixels are delta-filtered per row against the previous pixel's same
//! channel (smooth UI gradients become runs of small values) and then LZ4
//! compressed. Lossless: text stays pixel-perfect.
//!
//! ## Speed
//! Tile and row hashing are streamed (no copies) and parallel across cores.
//! Row hashes of the reference are cached between frames, and scroll
//! detection only runs when a large share of tiles changed, so typing or a
//! blinking cursor costs one tile-hash pass. In production, the capture
//! layer's dirty rectangles narrow hashing further.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet, VecDeque};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use xxhash_rust::xxh3::{xxh3_64, Xxh3};

/// Tile edge length in pixels.
pub const TILE: u32 = 64;
const BPP: usize = 4;
/// Default number of tiles both sides remember (~64 MB of BGRA at 64×64).
pub const DEFAULT_CACHE_TILES: usize = 4096;
/// Scroll detection runs only when at least this fraction of tiles changed.
const SCROLL_TRIGGER: f64 = 0.20;

#[derive(Debug, thiserror::Error)]
pub enum TileError {
    #[error("frame buffer too small: need {need} bytes, got {got}")]
    BufferTooSmall { need: usize, got: usize },
    #[error("tile reference {0:016x} not in decoder cache")]
    UnknownTile(u64),
    #[error("corrupt tile payload: {0}")]
    Corrupt(String),
}

/// A borrowed BGRA8 frame.
#[derive(Clone, Copy)]
pub struct Frame<'a> {
    pub width: u32,
    pub height: u32,
    /// Bytes per row (>= width * 4).
    pub stride: usize,
    pub data: &'a [u8],
}

impl<'a> Frame<'a> {
    pub fn packed(width: u32, height: u32, data: &'a [u8]) -> Self {
        Self { width, height, stride: width as usize * BPP, data }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scroll {
    /// Content that was at row `y` in the previous frame is now at `y + dy`.
    pub dy: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TileOp {
    Ref { tx: u16, ty: u16, hash: u64 },
    Data { tx: u16, ty: u16, hash: u64, payload: Vec<u8> },
    /// Full-width rows `[y, y + h)`, compressed — the band a scroll exposed.
    Strip { y: u32, h: u32, payload: Vec<u8> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Update {
    pub frame_id: u64,
    pub width: u32,
    pub height: u32,
    pub keyframe: bool,
    pub scroll: Option<Scroll>,
    pub ops: Vec<TileOp>,
}

impl Update {
    /// Approximate bytes on the wire (headers + payloads).
    pub fn wire_size(&self) -> usize {
        let header = 8 + 4 + 4 + 1 + if self.scroll.is_some() { 5 } else { 1 };
        header
            + self
                .ops
                .iter()
                .map(|op| match op {
                    TileOp::Ref { .. } => 1 + 4 + 8,
                    TileOp::Data { payload, .. } => 1 + 4 + 8 + 4 + payload.len(),
                    TileOp::Strip { payload, .. } => 1 + 8 + 4 + payload.len(),
                })
                .sum::<usize>()
    }

    pub fn is_empty(&self) -> bool {
        self.ops.is_empty() && self.scroll.is_none()
    }
}

/// FIFO set of tile hashes, identical policy on both ends.
struct TileSet {
    order: VecDeque<u64>,
    members: HashSet<u64>,
    capacity: usize,
}

impl TileSet {
    fn new(capacity: usize) -> Self {
        Self { order: VecDeque::new(), members: HashSet::new(), capacity }
    }
    fn contains(&self, h: u64) -> bool {
        self.members.contains(&h)
    }
    /// Inserts; returns the evicted hash, if any.
    fn insert(&mut self, h: u64) -> Option<u64> {
        if !self.members.insert(h) {
            return None;
        }
        self.order.push_back(h);
        if self.order.len() > self.capacity {
            let old = self.order.pop_front().expect("non-empty");
            self.members.remove(&old);
            return Some(old);
        }
        None
    }
    fn clear(&mut self) {
        self.order.clear();
        self.members.clear();
    }
}

fn tile_rect(tx: u32, ty: u32, w: u32, h: u32) -> (u32, u32, u32, u32) {
    let x = tx * TILE;
    let y = ty * TILE;
    (x, y, TILE.min(w - x), TILE.min(h - y))
}

/// Streaming hash of a tile region (dims mixed in so edge tiles of
/// different shapes never collide with full tiles).
fn hash_tile(buf: &[u8], stride: usize, x: u32, y: u32, tw: u32, th: u32) -> u64 {
    let row_bytes = tw as usize * BPP;
    let mut h = Xxh3::new();
    h.update(&tw.to_le_bytes());
    h.update(&th.to_le_bytes());
    for r in 0..th as usize {
        let off = (y as usize + r) * stride + x as usize * BPP;
        h.update(&buf[off..off + row_bytes]);
    }
    h.digest()
}

/// All tile hashes of a packed frame, in row-major tile order, in parallel.
fn hash_all_tiles(buf: &[u8], w: u32, h: u32) -> Vec<u64> {
    let (cols, rows) = (w.div_ceil(TILE), h.div_ceil(TILE));
    let stride = w as usize * BPP;
    (0..cols * rows)
        .into_par_iter()
        .map(|i| {
            let (x, y, tw, th) = tile_rect(i % cols, i / cols, w, h);
            hash_tile(buf, stride, x, y, tw, th)
        })
        .collect()
}

fn hash_all_rows(buf: &[u8], w: u32, h: u32) -> Vec<u64> {
    let row = w as usize * BPP;
    (0..h as usize).into_par_iter().map(|y| xxh3_64(&buf[y * row..(y + 1) * row])).collect()
}

fn copy_tile_out(buf: &[u8], stride: usize, x: u32, y: u32, tw: u32, th: u32) -> Vec<u8> {
    let row_bytes = tw as usize * BPP;
    let mut out = Vec::with_capacity(row_bytes * th as usize);
    for r in 0..th as usize {
        let off = (y as usize + r) * stride + x as usize * BPP;
        out.extend_from_slice(&buf[off..off + row_bytes]);
    }
    out
}

fn write_tile_in(buf: &mut [u8], stride: usize, x: u32, y: u32, tw: u32, th: u32, px: &[u8]) {
    let row_bytes = tw as usize * BPP;
    for r in 0..th as usize {
        let off = (y as usize + r) * stride + x as usize * BPP;
        buf[off..off + row_bytes].copy_from_slice(&px[r * row_bytes..(r + 1) * row_bytes]);
    }
}

/// Per-row delta vs previous pixel (same channel), then LZ4.
fn compress_pixels(px: &[u8], width_px: u32) -> Vec<u8> {
    let row = width_px as usize * BPP;
    let mut filtered = px.to_vec();
    for r in filtered.chunks_mut(row) {
        for i in (BPP..r.len()).rev() {
            r[i] = r[i].wrapping_sub(r[i - BPP]);
        }
    }
    lz4_flex::compress_prepend_size(&filtered)
}

fn decompress_pixels(payload: &[u8], width_px: u32, height_px: u32) -> Result<Vec<u8>, TileError> {
    let mut px = lz4_flex::decompress_size_prepended(payload).map_err(|e| TileError::Corrupt(e.to_string()))?;
    let row = width_px as usize * BPP;
    if px.len() != row * height_px as usize {
        return Err(TileError::Corrupt(format!("size {} != {}", px.len(), row * height_px as usize)));
    }
    for r in px.chunks_mut(row) {
        for i in BPP..r.len() {
            r[i] = r[i].wrapping_add(r[i - BPP]);
        }
    }
    Ok(px)
}

/// Shift a packed buffer vertically: row `y` of the result is row `y - dy`
/// of the input; rows with no source become zero. Identical on both ends.
fn shift_rows(buf: &mut [u8], width: u32, height: u32, dy: i32) {
    let row = width as usize * BPP;
    let h = height as i64;
    let dy = dy as i64;
    if dy == 0 {
        return;
    }
    if dy > 0 {
        for y in (0..h).rev() {
            let src = y - dy;
            let d = y as usize * row;
            if src >= 0 {
                let s = src as usize * row;
                buf.copy_within(s..s + row, d);
            } else {
                buf[d..d + row].fill(0);
            }
        }
    } else {
        for y in 0..h {
            let src = y - dy;
            let d = y as usize * row;
            if src < h {
                let s = src as usize * row;
                buf.copy_within(s..s + row, d);
            } else {
                buf[d..d + row].fill(0);
            }
        }
    }
}

/// Rows `[y, y + h)` exposed by a scroll of `dy` in a frame of `height`.
fn exposed_band(height: u32, dy: i32) -> (u32, u32) {
    if dy < 0 {
        let n = (-dy) as u32;
        (height - n, n)
    } else {
        (0, dy as u32)
    }
}

/// Detect a whole-frame vertical scroll by voting on row-hash matches.
///
/// Rows whose hash is common in the previous frame (blank lines, solid
/// backgrounds) carry no positional information and are ignored, otherwise a
/// mostly-empty screen would "match" at every offset.
fn detect_scroll(prev_rows: &[u64], cur_rows: &[u64]) -> Option<i32> {
    let h = prev_rows.len();
    if h < 16 || cur_rows.len() != h {
        return None;
    }
    let mut positions: HashMap<u64, Vec<usize>> = HashMap::with_capacity(h);
    for (y, hsh) in prev_rows.iter().enumerate() {
        positions.entry(*hsh).or_default().push(y);
    }

    let mut votes: HashMap<i64, usize> = HashMap::new();
    let mut informative = 0usize;
    let mut unchanged = 0usize;
    for (y, hsh) in cur_rows.iter().enumerate() {
        let Some(ps) = positions.get(hsh) else { continue };
        if ps.len() > 4 {
            continue; // repetitive row — no positional information
        }
        informative += 1;
        for &py in ps {
            let d = y as i64 - py as i64;
            if d == 0 {
                unchanged += 1;
            } else {
                *votes.entry(d).or_default() += 1;
            }
        }
    }
    let (&best, &count) = votes.iter().max_by_key(|(_, c)| **c)?;
    if informative >= 8 && count * 2 >= informative && count > unchanged && best.unsigned_abs() < h as u64 {
        Some(best as i32)
    } else {
        None
    }
}

pub struct Encoder {
    width: u32,
    height: u32,
    reference: Vec<u8>,
    ref_tile_hashes: Vec<u64>,
    /// Row hashes of `reference`, cached between frames; None = stale.
    ref_row_hashes: Option<Vec<u64>>,
    known: TileSet,
    frame_id: u64,
    need_keyframe: bool,
    scroll_detection: bool,
}

impl Encoder {
    pub fn new() -> Self {
        Self::with_cache_capacity(DEFAULT_CACHE_TILES)
    }

    pub fn with_cache_capacity(capacity: usize) -> Self {
        Self {
            width: 0,
            height: 0,
            reference: Vec::new(),
            ref_tile_hashes: Vec::new(),
            ref_row_hashes: None,
            known: TileSet::new(capacity),
            frame_id: 0,
            need_keyframe: true,
            scroll_detection: true,
        }
    }

    pub fn set_scroll_detection(&mut self, on: bool) {
        self.scroll_detection = on;
    }

    /// Next update re-sends every tile (e.g. a new viewer with an empty cache).
    pub fn force_keyframe(&mut self) {
        self.need_keyframe = true;
    }

    pub fn encode(&mut self, frame: Frame<'_>) -> Result<Update, TileError> {
        let row = frame.width as usize * BPP;
        let need = (frame.height as usize).saturating_sub(1) * frame.stride + row;
        if frame.data.len() < need {
            return Err(TileError::BufferTooSmall { need, got: frame.data.len() });
        }
        // Only repack when the source has padded rows.
        let cur: Cow<[u8]> = if frame.stride == row {
            Cow::Borrowed(&frame.data[..row * frame.height as usize])
        } else {
            let mut packed = Vec::with_capacity(row * frame.height as usize);
            for y in 0..frame.height as usize {
                packed.extend_from_slice(&frame.data[y * frame.stride..y * frame.stride + row]);
            }
            Cow::Owned(packed)
        };

        let dims_changed = frame.width != self.width || frame.height != self.height;
        let keyframe = self.need_keyframe || dims_changed;
        self.frame_id += 1;
        let (w, h) = (frame.width, frame.height);
        let stride = row;
        let cols = w.div_ceil(TILE);

        if keyframe {
            self.width = w;
            self.height = h;
            self.reference = vec![0; cur.len()];
            self.ref_tile_hashes.clear();
            self.ref_row_hashes = None;
            self.known.clear();
            self.need_keyframe = false;
        }

        let cur_tiles = hash_all_tiles(&cur, w, h);
        let mut ops = Vec::new();
        let mut scroll = None;
        let mut cur_rows: Option<Vec<u64>> = None;

        if !keyframe && self.scroll_detection {
            let changed = cur_tiles.iter().zip(&self.ref_tile_hashes).filter(|(a, b)| a != b).count();
            if changed as f64 >= cur_tiles.len() as f64 * SCROLL_TRIGGER {
                let rows_now = hash_all_rows(&cur, w, h);
                let ref_rows = match self.ref_row_hashes.take() {
                    Some(r) => r,
                    None => hash_all_rows(&self.reference, w, h),
                };
                if let Some(dy) = detect_scroll(&ref_rows, &rows_now) {
                    shift_rows(&mut self.reference, w, h, dy);
                    let (by, bh) = exposed_band(h, dy);
                    let band = &cur[by as usize * row..(by + bh) as usize * row];
                    ops.push(TileOp::Strip { y: by, h: bh, payload: compress_pixels(band, w) });
                    self.reference[by as usize * row..(by + bh) as usize * row].copy_from_slice(band);
                    self.ref_tile_hashes = hash_all_tiles(&self.reference, w, h);
                    scroll = Some(Scroll { dy });
                }
                cur_rows = Some(rows_now);
            }
        }

        for (idx, &hsh) in cur_tiles.iter().enumerate() {
            if !keyframe && self.ref_tile_hashes.get(idx) == Some(&hsh) {
                continue; // unchanged vs what the receiver already shows
            }
            let (tx, ty) = (idx as u32 % cols, idx as u32 / cols);
            if self.known.contains(hsh) {
                ops.push(TileOp::Ref { tx: tx as u16, ty: ty as u16, hash: hsh });
            } else {
                let (x, y, tw, th) = tile_rect(tx, ty, w, h);
                let px = copy_tile_out(&cur, stride, x, y, tw, th);
                ops.push(TileOp::Data { tx: tx as u16, ty: ty as u16, hash: hsh, payload: compress_pixels(&px, tw) });
                self.known.insert(hsh);
            }
        }

        self.reference.copy_from_slice(&cur);
        self.ref_tile_hashes = cur_tiles;
        self.ref_row_hashes = cur_rows;
        Ok(Update { frame_id: self.frame_id, width: w, height: h, keyframe, scroll, ops })
    }
}

impl Default for Encoder {
    fn default() -> Self {
        Self::new()
    }
}

pub struct Decoder {
    width: u32,
    height: u32,
    framebuffer: Vec<u8>,
    cache: HashMap<u64, Vec<u8>>,
    known: TileSet,
}

impl Decoder {
    pub fn new() -> Self {
        Self::with_cache_capacity(DEFAULT_CACHE_TILES)
    }

    pub fn with_cache_capacity(capacity: usize) -> Self {
        Self { width: 0, height: 0, framebuffer: Vec::new(), cache: HashMap::new(), known: TileSet::new(capacity) }
    }

    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }
    /// Current reconstructed frame, packed BGRA8.
    pub fn framebuffer(&self) -> &[u8] {
        &self.framebuffer
    }

    pub fn apply(&mut self, update: &Update) -> Result<(), TileError> {
        if update.keyframe || update.width != self.width || update.height != self.height {
            self.width = update.width;
            self.height = update.height;
            self.framebuffer = vec![0; update.width as usize * update.height as usize * BPP];
            self.cache.clear();
            self.known.clear();
        }
        if let Some(Scroll { dy }) = update.scroll {
            shift_rows(&mut self.framebuffer, self.width, self.height, dy);
        }
        let stride = self.width as usize * BPP;
        for op in &update.ops {
            match op {
                TileOp::Ref { tx, ty, hash } => {
                    let px = self.cache.get(hash).ok_or(TileError::UnknownTile(*hash))?;
                    let (x, y, tw, th) = tile_rect(*tx as u32, *ty as u32, self.width, self.height);
                    write_tile_in(&mut self.framebuffer, stride, x, y, tw, th, px);
                }
                TileOp::Data { tx, ty, hash, payload } => {
                    let (x, y, tw, th) = tile_rect(*tx as u32, *ty as u32, self.width, self.height);
                    let px = decompress_pixels(payload, tw, th)?;
                    write_tile_in(&mut self.framebuffer, stride, x, y, tw, th, &px);
                    if let Some(evicted) = self.known.insert(*hash) {
                        self.cache.remove(&evicted);
                    }
                    self.cache.insert(*hash, px);
                }
                TileOp::Strip { y, h, payload } => {
                    let px = decompress_pixels(payload, self.width, *h)?;
                    let start = *y as usize * stride;
                    self.framebuffer[start..start + px.len()].copy_from_slice(&px);
                }
            }
        }
        Ok(())
    }
}

impl Default for Decoder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::StdRng, Rng, SeedableRng};

    /// A synthetic "document": dark background, lines of glyph-like blocks
    /// with varied widths — structurally like a code editor or chat log.
    fn document(width: u32, height: u32, seed: u64) -> Vec<u8> {
        let mut rng = StdRng::seed_from_u64(seed);
        let mut buf = vec![0u8; (width * height * 4) as usize];
        for px in buf.chunks_mut(4) {
            px.copy_from_slice(&[30, 30, 30, 255]);
        }
        let line_h = 18;
        let mut y = 4;
        while y + line_h < height {
            let mut x = 8 + rng.random_range(0..40);
            let len = rng.random_range(20..(width - 60).max(21));
            while x < len {
                let glyph_w = rng.random_range(5..9);
                if rng.random_bool(0.15) {
                    x += glyph_w; // space
                    continue;
                }
                let color = [rng.random_range(150..255), rng.random_range(150..255), rng.random_range(150..255), 255];
                for gy in 0..12 {
                    for gx in 0..glyph_w.min(width - x) {
                        if rng.random_bool(0.55) {
                            let i = (((y + gy) * width + x + gx) * 4) as usize;
                            buf[i..i + 4].copy_from_slice(&color);
                        }
                    }
                }
                x += glyph_w + 1;
            }
            y += line_h;
        }
        buf
    }

    fn roundtrip(enc: &mut Encoder, dec: &mut Decoder, w: u32, h: u32, px: &[u8]) -> Update {
        let u = enc.encode(Frame::packed(w, h, px)).unwrap();
        dec.apply(&u).unwrap();
        assert_eq!(dec.framebuffer(), px, "decoder must reproduce the frame exactly");
        u
    }

    #[test]
    fn keyframe_roundtrips_exactly() {
        let (w, h) = (1280, 720);
        let px = document(w, h, 1);
        let (mut e, mut d) = (Encoder::new(), Decoder::new());
        let u = roundtrip(&mut e, &mut d, w, h, &px);
        assert!(u.keyframe);
        assert!(u.wire_size() < px.len(), "lossless keyframe smaller than raw");
    }

    #[test]
    fn static_screen_costs_zero() {
        let (w, h) = (1920, 1080);
        let px = document(w, h, 2);
        let (mut e, mut d) = (Encoder::new(), Decoder::new());
        roundtrip(&mut e, &mut d, w, h, &px);
        let u = roundtrip(&mut e, &mut d, w, h, &px);
        assert!(u.ops.is_empty() && u.scroll.is_none());
    }

    #[test]
    fn small_edit_sends_only_touched_tiles() {
        let (w, h) = (1920, 1080);
        let mut px = document(w, h, 3);
        let (mut e, mut d) = (Encoder::new(), Decoder::new());
        roundtrip(&mut e, &mut d, w, h, &px);
        // Type a few characters inside one tile.
        for y in 300..312 {
            for x in 500..530 {
                let i = ((y * w + x) * 4) as usize;
                px[i..i + 4].copy_from_slice(&[255, 200, 0, 255]);
            }
        }
        let u = roundtrip(&mut e, &mut d, w, h, &px);
        assert!(u.ops.len() <= 2, "expected 1-2 tiles, got {}", u.ops.len());
        assert!(u.wire_size() < 16 * 1024);
    }

    #[test]
    fn scroll_sends_only_exposed_rows() {
        let (w, h) = (1920, 1080);
        let tall = document(w, h * 2, 4);
        let row = (w * 4) as usize;
        let view = |top: u32| tall[top as usize * row..(top + h) as usize * row].to_vec();
        let (mut e, mut d) = (Encoder::new(), Decoder::new());
        let key = roundtrip(&mut e, &mut d, w, h, &view(0));
        let scrolled = roundtrip(&mut e, &mut d, w, h, &view(37));
        assert_eq!(scrolled.scroll, Some(Scroll { dy: -37 }));
        // Only ~37 new rows plus partial edge tiles should be sent.
        assert!(
            scrolled.wire_size() * 4 < key.wire_size(),
            "scroll {} bytes vs keyframe {} bytes",
            scrolled.wire_size(),
            key.wire_size()
        );
    }

    #[test]
    fn revisited_content_is_sent_by_reference() {
        let (w, h) = (1280, 720);
        let a = document(w, h, 5);
        let b = document(w, h, 6);
        let (mut e, mut d) = (Encoder::new(), Decoder::new());
        e.set_scroll_detection(false);
        roundtrip(&mut e, &mut d, w, h, &a);
        roundtrip(&mut e, &mut d, w, h, &b); // switch tab
        let back = roundtrip(&mut e, &mut d, w, h, &a); // switch back
        assert!(back.ops.iter().all(|op| matches!(op, TileOp::Ref { .. })), "returning to seen content must be refs only");
        assert!(back.wire_size() < 64 * 1024);
    }

    #[test]
    fn cache_eviction_stays_coherent() {
        let (w, h) = (640, 384);
        let (mut e, mut d) = (Encoder::with_cache_capacity(40), Decoder::with_cache_capacity(40));
        e.set_scroll_detection(false);
        for seed in 0..30 {
            let px = document(w, h, 100 + seed % 7);
            roundtrip(&mut e, &mut d, w, h, &px);
        }
    }

    #[test]
    fn odd_sizes_and_strides() {
        let (w, h) = (1366, 769);
        let px = document(w, h, 7);
        // Padded stride as GPU readbacks often produce.
        let stride = (w as usize * 4).next_multiple_of(256);
        let mut padded = vec![0u8; stride * h as usize];
        for y in 0..h as usize {
            padded[y * stride..y * stride + w as usize * 4].copy_from_slice(&px[y * w as usize * 4..(y + 1) * w as usize * 4]);
        }
        let mut e = Encoder::new();
        let mut d = Decoder::new();
        let u = e.encode(Frame { width: w, height: h, stride, data: &padded }).unwrap();
        d.apply(&u).unwrap();
        assert_eq!(d.framebuffer(), &px[..]);
    }
}
