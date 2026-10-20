//! Speculative playout.
//!
//! ## The problem
//! Packets arrive with jitter. A conventional jitter buffer delays playout by
//! roughly the 99.9th-percentile arrival delay so it almost never has to
//! conceal a missing packet. That wait is most of the mouth-to-ear latency in
//! voice chat, and it is sized for the rare straggler, not the common case.
//!
//! ## The idea
//! Run playout at an aggressive percentile (e.g. p90). When a frame's slot
//! comes up and the packet is not there, *speculate*: synthesize the frame
//! with a concealer (Opus deep PLC / DRED in production). If the real packet
//! then arrives within a short correction window, emit a correction so the
//! output crossfades back onto real audio instead of staying on the guess.
//! Latency is bought with computation, and modern neural concealment makes
//! the guesses good enough that a few percent of speculated frames are
//! inaudible, while the whole conversation is tens of milliseconds tighter.
//!
//! The deadline adapts: it tracks a running quantile of observed lateness
//! (relative to the earliest-seen send/arrival offset), so a clean network
//! converges to a near-zero buffer and a jittery one backs off.
//!
//! This module is codec-agnostic: frames are `F`, and concealment is a
//! closure. All time is in microseconds supplied by the caller, which makes
//! the logic deterministic and testable against recorded network traces.

use std::collections::BTreeMap;

/// What the output should do for one frame slot.
#[derive(Debug, Clone, PartialEq)]
pub enum Playout<F> {
    /// The real frame arrived in time.
    Real { seq: u64, frame: F },
    /// Missing at its deadline — synthesized.
    Speculated { seq: u64, frame: F },
    /// Nothing to play yet (stream not started).
    Idle,
}

/// A late packet for a slot that was already speculated. If it is still
/// within the correction window the caller crossfades from the speculated
/// output into it.
#[derive(Debug, Clone, PartialEq)]
pub struct Correction<F> {
    pub seq: u64,
    pub frame: F,
    pub late_by_us: i64,
}

#[derive(Debug, Clone)]
pub struct Config {
    /// Duration of one frame (e.g. 10_000 for 10 ms Opus).
    pub frame_us: i64,
    /// Target arrival quantile the deadline tracks, e.g. 0.90.
    pub target_quantile: f64,
    /// Lower/upper clamp on buffering beyond the network floor.
    pub min_buffer_us: i64,
    pub max_buffer_us: i64,
    /// Late packets for speculated slots are still usable for this long.
    pub correction_window_us: i64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            frame_us: 10_000,
            target_quantile: 0.95,
            min_buffer_us: 2_000,
            max_buffer_us: 120_000,
            correction_window_us: 20_000,
        }
    }
}

/// Fixed-bucket histogram of lateness with exponential decay so the
/// estimate tracks changing network conditions.
struct LatenessQuantile {
    bucket_us: i64,
    buckets: Vec<f64>,
    total: f64,
    decay: f64,
}

impl LatenessQuantile {
    fn new(bucket_us: i64, max_us: i64) -> Self {
        let n = (max_us / bucket_us + 1) as usize;
        Self { bucket_us, buckets: vec![0.0; n], total: 0.0, decay: 0.999 }
    }
    fn observe(&mut self, lateness_us: i64) {
        for b in &mut self.buckets {
            *b *= self.decay;
        }
        self.total *= self.decay;
        let i = ((lateness_us.max(0) / self.bucket_us) as usize).min(self.buckets.len() - 1);
        self.buckets[i] += 1.0;
        self.total += 1.0;
    }
    fn quantile(&self, q: f64) -> i64 {
        if self.total <= 0.0 {
            return 0;
        }
        let target = self.total * q;
        let mut acc = 0.0;
        for (i, b) in self.buckets.iter().enumerate() {
            acc += b;
            if acc >= target {
                return (i as i64 + 1) * self.bucket_us;
            }
        }
        self.buckets.len() as i64 * self.bucket_us
    }
}

pub struct SpeculativePlayout<F> {
    cfg: Config,
    /// Packets received but not yet played, by sequence number.
    pending: BTreeMap<u64, F>,
    /// Slots that were speculated, with the playout time they were due.
    speculated: BTreeMap<u64, i64>,
    next_seq: Option<u64>,
    /// min over packets of (arrival - send): the network's floor offset.
    base_offset_us: Option<i64>,
    lateness: LatenessQuantile,
    /// Send-clock time of seq 0 (first packet's send time minus seq*frame).
    origin_send_us: Option<i64>,
    stats: Stats,
}

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Stats {
    pub real: u64,
    pub speculated: u64,
    pub corrected: u64,
    pub dropped_late: u64,
}

impl<F: Clone> SpeculativePlayout<F> {
    pub fn new(cfg: Config) -> Self {
        let lateness = LatenessQuantile::new(500, cfg.max_buffer_us);
        Self {
            cfg,
            pending: BTreeMap::new(),
            speculated: BTreeMap::new(),
            next_seq: None,
            base_offset_us: None,
            lateness,
            origin_send_us: None,
            stats: Stats::default(),
        }
    }

    pub fn stats(&self) -> Stats {
        self.stats
    }

    /// Current buffering beyond the network floor, in microseconds.
    pub fn buffer_us(&self) -> i64 {
        self.lateness
            .quantile(self.cfg.target_quantile)
            .clamp(self.cfg.min_buffer_us, self.cfg.max_buffer_us)
    }

    /// Playout time (receiver clock) for a sequence number.
    fn deadline_for(&self, seq: u64) -> Option<i64> {
        let origin = self.origin_send_us?;
        let base = self.base_offset_us?;
        Some(origin + seq as i64 * self.cfg.frame_us + base + self.buffer_us())
    }

    /// A packet arrived. `send_us` is the sender's capture timestamp,
    /// `arrival_us` the local receive time. Returns a correction if this
    /// packet fills a slot that was already speculated and is still fresh.
    pub fn push(&mut self, seq: u64, send_us: i64, arrival_us: i64, frame: F) -> Option<Correction<F>> {
        let offset = arrival_us - send_us;
        if self.origin_send_us.is_none() {
            self.origin_send_us = Some(send_us - seq as i64 * self.cfg.frame_us);
            self.next_seq = Some(seq);
        }
        let base = self.base_offset_us.map_or(offset, |b| b.min(offset));
        self.base_offset_us = Some(base);
        self.lateness.observe(offset - base);

        if let Some(due) = self.speculated.remove(&seq) {
            let late_by = arrival_us - due;
            if late_by <= self.cfg.correction_window_us {
                self.stats.corrected += 1;
                return Some(Correction { seq, frame, late_by_us: late_by });
            }
            self.stats.dropped_late += 1;
            return None;
        }
        if self.next_seq.is_some_and(|n| seq < n) {
            self.stats.dropped_late += 1; // already played or speculated long ago
            return None;
        }
        self.pending.insert(seq, frame);
        None
    }

    /// Produce output for every slot whose deadline is <= `now_us`.
    /// `conceal(seq)` synthesizes a missing frame.
    pub fn pull(&mut self, now_us: i64, mut conceal: impl FnMut(u64) -> F) -> Vec<Playout<F>> {
        let mut out = Vec::new();
        loop {
            let Some(seq) = self.next_seq else {
                out.push(Playout::Idle);
                return out;
            };
            let Some(deadline) = self.deadline_for(seq) else { return out };
            if deadline > now_us {
                return out;
            }
            if let Some(frame) = self.pending.remove(&seq) {
                self.stats.real += 1;
                out.push(Playout::Real { seq, frame });
            } else {
                self.stats.speculated += 1;
                self.speculated.insert(seq, deadline);
                out.push(Playout::Speculated { seq, frame: conceal(seq) });
            }
            self.next_seq = Some(seq + 1);
            // Forget speculation records that can no longer be corrected.
            let horizon = now_us - self.cfg.correction_window_us * 4;
            self.speculated.retain(|_, due| *due >= horizon);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::StdRng, Rng, SeedableRng};

    /// Simulated network: 10 ms frames, base one-way delay, gamma-ish
    /// jitter, occasional bursts, random loss.
    struct Trace {
        packets: Vec<(u64, i64, i64)>, // seq, send, arrival (None = lost filtered out)
        frames: u64,
    }

    fn trace(seed: u64, frames: u64, jitter_ms: f64, burst_prob: f64, loss: f64) -> Trace {
        let mut rng = StdRng::seed_from_u64(seed);
        let mut packets = Vec::new();
        let mut burst_left = 0u32;
        for seq in 0..frames {
            let send = seq as i64 * 10_000;
            if rng.random_bool(loss) {
                continue;
            }
            // Exponential-tailed jitter: most packets fast, long tail.
            let u: f64 = rng.random_range(1e-6..1.0);
            let mut j = -u.ln() * jitter_ms * 1000.0;
            if burst_left == 0 && rng.random_bool(burst_prob) {
                burst_left = rng.random_range(3..12);
            }
            if burst_left > 0 {
                j += 60_000.0; // a congestion spike delays a run of packets
                burst_left -= 1;
            }
            packets.push((seq, send, send + 25_000 + j as i64));
        }
        packets.sort_by_key(|p| p.2);
        Trace { packets, frames }
    }

    /// Classic buffer baseline: fixed p99.9 delay, no speculation.
    fn classic_buffer_us(t: &Trace) -> i64 {
        let mut lat: Vec<i64> = t.packets.iter().map(|(_, s, a)| a - s).collect();
        lat.sort_unstable();
        let base = lat[0];
        lat[(lat.len() as f64 * 0.999) as usize].saturating_sub(base)
    }

    fn run(t: &Trace, cfg: Config) -> (Stats, i64) {
        let mut sp: SpeculativePlayout<u64> = SpeculativePlayout::new(cfg);
        let end = t.frames as i64 * 10_000 + 400_000;
        let mut i = 0;
        let mut buf_sum = 0i64;
        let mut buf_n = 0i64;
        let mut now = 0;
        while now < end {
            while i < t.packets.len() && t.packets[i].2 <= now {
                let (seq, send, arr) = t.packets[i];
                let _ = sp.push(seq, send, arr, seq);
                i += 1;
            }
            let _ = sp.pull(now, |s| s);
            if now > 2_000_000 {
                buf_sum += sp.buffer_us();
                buf_n += 1;
            }
            now += 1_000;
        }
        (sp.stats(), buf_sum / buf_n.max(1))
    }

    #[test]
    fn clean_network_converges_to_tiny_buffer() {
        let t = trace(1, 6000, 0.3, 0.0, 0.0);
        let (stats, avg_buf) = run(&t, Config::default());
        assert!(avg_buf <= 5_000, "clean link buffer {avg_buf}us");
        assert!((stats.speculated as f64) < stats.real as f64 * 0.12);
    }

    #[test]
    fn beats_classic_buffer_latency_on_jittery_network() {
        let t = trace(2, 12000, 4.0, 0.004, 0.01);
        let classic = classic_buffer_us(&t);
        let (stats, avg_buf) = run(&t, Config::default());
        let total = stats.real + stats.speculated;
        let spec_rate = stats.speculated as f64 / total as f64;
        println!(
            "classic p99.9 buffer = {:.1} ms | speculative avg buffer = {:.1} ms | speculated {:.1}% (corrected {})",
            classic as f64 / 1000.0,
            avg_buf as f64 / 1000.0,
            spec_rate * 100.0,
            stats.corrected
        );
        assert!(avg_buf * 3 < classic, "speculative {avg_buf}us should be far below classic {classic}us");
        assert!(spec_rate < 0.15, "speculation rate {spec_rate}");
    }

    #[test]
    fn late_packet_for_speculated_slot_yields_correction() {
        let cfg = Config { min_buffer_us: 2_000, ..Config::default() };
        let mut sp: SpeculativePlayout<u64> = SpeculativePlayout::new(cfg);
        // Establish timing with seq 0 and 1.
        sp.push(0, 0, 25_000, 0);
        sp.push(1, 10_000, 35_000, 1);
        let _ = sp.pull(40_000, |s| s);
        // seq 2 missing at its deadline -> speculated.
        let out = sp.pull(50_000, |s| 1000 + s);
        assert!(out.iter().any(|p| matches!(p, Playout::Speculated { seq: 2, frame: 1002 })));
        // Real seq 2 arrives 5 ms later -> correction.
        let c = sp.push(2, 20_000, 52_000, 2).expect("correction");
        assert_eq!(c.seq, 2);
        assert!(c.late_by_us > 0 && c.late_by_us <= 20_000);
    }
}
