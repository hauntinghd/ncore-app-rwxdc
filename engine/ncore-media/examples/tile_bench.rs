//! Measure the tile codec on desktop-like content.
//! `cargo run --release --example tile_bench`

use std::time::Instant;

use ncore_media::tiles::{Decoder, Encoder, Frame};

/// Deterministic pseudo-random generator (no extra deps in examples).
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn range(&mut self, lo: u32, hi: u32) -> u32 {
        lo + (self.next() % (hi - lo) as u64) as u32
    }
}

fn document(width: u32, height: u32, seed: u64) -> Vec<u8> {
    let mut rng = Lcg(seed);
    let mut buf = vec![0u8; (width * height * 4) as usize];
    for px in buf.chunks_mut(4) {
        px.copy_from_slice(&[30, 30, 30, 255]);
    }
    let mut y = 4;
    while y + 18 < height {
        let mut x = 8 + rng.range(0, 40);
        let len = rng.range(20, (width - 60).max(21));
        while x < len {
            let gw = rng.range(5, 9);
            if rng.range(0, 100) < 15 {
                x += gw;
                continue;
            }
            let c = [rng.range(150, 255) as u8, rng.range(150, 255) as u8, rng.range(150, 255) as u8, 255];
            for gy in 0..12 {
                for gx in 0..gw.min(width - x) {
                    if rng.range(0, 100) < 55 {
                        let i = (((y + gy) * width + x + gx) * 4) as usize;
                        buf[i..i + 4].copy_from_slice(&c);
                    }
                }
            }
            x += gw + 1;
        }
        y += 18;
    }
    buf
}

fn main() {
    for &(w, h) in &[(1920u32, 1080u32), (2560, 1440)] {
        let raw = (w * h * 4) as usize;
        let tall = document(w, h * 3, 42);
        let row = (w * 4) as usize;
        let view = |top: u32| tall[top as usize * row..(top + h) as usize * row].to_vec();

        let mut enc = Encoder::new();
        let mut dec = Decoder::new();

        let f0 = view(0);
        let t = Instant::now();
        let key = enc.encode(Frame::packed(w, h, &f0)).unwrap();
        let key_ms = t.elapsed().as_secs_f64() * 1000.0;
        dec.apply(&key).unwrap();

        let t = Instant::now();
        let same = enc.encode(Frame::packed(w, h, &f0)).unwrap();
        let static_ms = t.elapsed().as_secs_f64() * 1000.0;

        // Smooth scroll: 60 frames scrolling 8 px each (480 px total).
        let mut scroll_bytes = 0usize;
        let t = Instant::now();
        for i in 1..=60u32 {
            let f = view(i * 8);
            let u = enc.encode(Frame::packed(w, h, &f)).unwrap();
            dec.apply(&u).unwrap();
            assert_eq!(dec.framebuffer(), &f[..]);
            scroll_bytes += u.wire_size();
        }
        let scroll_ms = t.elapsed().as_secs_f64() * 1000.0 / 60.0;

        println!("=== {w}x{h} desktop text ===");
        println!("  raw frame             : {:>9.1} KB", raw as f64 / 1024.0);
        println!("  keyframe (lossless)   : {:>9.1} KB  ({:.1}x smaller)  encode {:.1} ms", key.wire_size() as f64 / 1024.0, raw as f64 / key.wire_size() as f64, key_ms);
        println!("  static frame          : {:>9} B   encode {:.2} ms", same.wire_size(), static_ms);
        println!(
            "  scrolling @60fps      : {:>9.1} KB/frame avg -> {:.2} Mbit/s, encode {:.2} ms/frame",
            scroll_bytes as f64 / 60.0 / 1024.0,
            scroll_bytes as f64 * 8.0 / 1_000_000.0, // 60 frames = 1 s
            scroll_ms
        );
    }
}
