//! End-to-end on real capture: WGC → tile encoder → decoder.
//! `cargo run --release --features capture --example live_demo [seconds]`

#[cfg(windows)]
fn main() {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use ncore_media::{capture, live, tiles::Decoder};

    let seconds: u64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(5);

    let t = Instant::now();
    let sources = capture::list_sources(Some(std::process::id()));
    println!("enumerated {} sources with thumbnails in {:.0} ms:", sources.len(), t.elapsed().as_secs_f64() * 1000.0);
    for s in sources.iter().take(8) {
        println!(
            "  [{:6}] {:<40} {}x{}  thumb {} KB",
            s.kind,
            s.name.chars().take(40).collect::<String>(),
            s.width,
            s.height,
            s.thumbnail_data_url.len() / 1024
        );
    }

    let id = live::primary_screen_id().expect("primary monitor");
    println!("\ncapturing {id} for {seconds}s at up to 60 fps...");
    let (tx, rx) = mpsc::channel();
    let cap = live::start(&id, 60, Box::new(move |u| { let _ = tx.send(u); })).expect("start capture");

    let mut dec = Decoder::new();
    let mut updates = 0u64;
    let mut keyframe_bytes = 0usize;
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
        if let Ok(u) = rx.recv_timeout(Duration::from_millis(50)) {
            if u.keyframe {
                keyframe_bytes = u.wire_size();
            }
            dec.apply(&u).expect("decode");
            updates += 1;
        }
    }
    let stats = cap.stats();
    cap.stop();

    let secs = seconds as f64;
    println!("frames captured   : {} ({:.1} fps delivered by WGC)", stats.frames_captured, stats.frames_captured as f64 / secs);
    println!("updates sent      : {updates}");
    println!("keyframe          : {:.1} KB for {}x{}", keyframe_bytes as f64 / 1024.0, dec.width(), dec.height());
    println!(
        "bandwidth (avg)   : {:.2} Mbit/s incl. keyframe, {:.1} KB/update",
        stats.bytes_sent as f64 * 8.0 / 1_000_000.0 / secs,
        stats.bytes_sent as f64 / 1024.0 / updates.max(1) as f64
    );
    println!(
        "encode time (avg) : {:.2} ms/frame",
        stats.encode_us_total as f64 / 1000.0 / stats.frames_captured.max(1) as f64
    );
    println!("decoder verified every update (lossless reconstruction applied without error)");
}

#[cfg(not(windows))]
fn main() {
    eprintln!("live_demo requires Windows (Windows Graphics Capture)");
}
