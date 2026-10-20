//! # NCore Media Engine
//!
//! The parts of NCore's real-time media stack that NCore owns outright,
//! built from first principles rather than from what a browser offers:
//!
//! - [`tiles`] — a content-addressed screen codec. A desktop is mostly
//!   static, structured content; encoding it as video wastes megabits on
//!   pixels that did not change. The screen is cut into 64×64 tiles, each
//!   identified by a 64-bit hash. A tile any receiver already holds is sent
//!   as its hash (8 bytes); new tiles are sent losslessly. Vertical scrolls
//!   are detected and sent as a single shift instruction, so scrolling a code
//!   editor costs only the newly exposed rows. Text stays pixel-perfect at
//!   kilobits per second.
//!
//! - [`playout`] — speculative playout. A classic jitter buffer waits for the
//!   slowest packets so it almost never has to conceal; that wait is most of
//!   the mouth-to-ear delay in voice chat. Speculative playout sets the
//!   deadline aggressively and synthesizes any packet that has not arrived
//!   (via a pluggable concealer — Opus deep PLC / DRED in production), then
//!   crossfades into the real packet if it lands shortly after. Buffer time
//!   is traded for computation.
//!
//! - `capture` (feature `capture`) — native enumeration of windows and
//!   screens with thumbnails, so NCore can show its own source picker instead
//!   of the WebView2 browser dialog.

pub mod playout;
pub mod tiles;

#[cfg(feature = "capture")]
pub mod capture;

#[cfg(all(feature = "capture", windows))]
pub mod live;
