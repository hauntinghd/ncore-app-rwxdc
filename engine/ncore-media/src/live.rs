//! Live screen/window capture into the tile encoder (Windows Graphics Capture).
//!
//! `start` opens a WGC session on a source id produced by
//! [`crate::capture::list_sources`] ("window:<hwnd>" / "screen:<hmonitor>"),
//! encodes each frame with [`crate::tiles::Encoder`], and hands every
//! non-empty [`Update`] to the caller's sink. WGC only delivers frames when
//! something changed, so an idle screen produces nothing at all.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame as WgcFrame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::settings::GraphicsCaptureItemType;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings, MinimumUpdateIntervalSettings,
    SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use crate::tiles::{Encoder, Frame, Update};

pub type UpdateSink = Box<dyn FnMut(Update) + Send>;

#[derive(Debug, Default, Clone, Copy)]
pub struct LiveStats {
    pub frames_captured: u64,
    pub updates_sent: u64,
    pub bytes_sent: u64,
    pub encode_us_total: u64,
}

#[derive(Clone)]
pub struct Flags {
    min_interval: Duration,
    sink: Arc<Mutex<UpdateSink>>,
    stats: Arc<Mutex<LiveStats>>,
}

struct Handler {
    encoder: Encoder,
    flags: Flags,
    last_encode: Option<Instant>,
    scratch: Vec<u8>,
}

impl GraphicsCaptureApiHandler for Handler {
    type Flags = Flags;
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self { encoder: Encoder::new(), flags: ctx.flags, last_encode: None, scratch: Vec::new() })
    }

    fn on_frame_arrived(&mut self, frame: &mut WgcFrame, _control: InternalCaptureControl) -> Result<(), Self::Error> {
        if let Some(t) = self.last_encode {
            if t.elapsed() < self.flags.min_interval {
                return Ok(());
            }
        }
        self.last_encode = Some(Instant::now());

        let started = Instant::now();
        let fb = frame.buffer()?;
        let (w, h) = (fb.width(), fb.height());
        let data = fb.as_nopadding_buffer(&mut self.scratch);
        let update = self.encoder.encode(Frame::packed(w, h, data))?;
        let encode_us = started.elapsed().as_micros() as u64;

        {
            let mut s = self.flags.stats.lock().expect("stats lock");
            s.frames_captured += 1;
            s.encode_us_total += encode_us;
            if !update.is_empty() {
                s.updates_sent += 1;
                s.bytes_sent += update.wire_size() as u64;
            }
        }
        if !update.is_empty() {
            (self.flags.sink.lock().expect("sink lock"))(update);
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }
}

pub struct LiveCapture {
    control: Option<CaptureControl<Handler, Box<dyn std::error::Error + Send + Sync>>>,
    stats: Arc<Mutex<LiveStats>>,
}

impl LiveCapture {
    pub fn stats(&self) -> LiveStats {
        *self.stats.lock().expect("stats lock")
    }

    pub fn stop(mut self) {
        if let Some(c) = self.control.take() {
            let _ = c.stop();
        }
    }
}

impl Drop for LiveCapture {
    fn drop(&mut self) {
        if let Some(c) = self.control.take() {
            let _ = c.stop();
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LiveError {
    #[error("unrecognised source id: {0}")]
    BadSource(String),
    #[error("capture failed to start: {0}")]
    Start(String),
}

fn settings_for<T: TryInto<GraphicsCaptureItemType>>(item: T, flags: Flags) -> Settings<Flags, T> {
    Settings::new(
        item,
        CursorCaptureSettings::WithCursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    )
}

/// Start capturing `source_id` at up to `fps`, calling `sink` with every
/// non-empty update. The first update is always a keyframe.
pub fn start(source_id: &str, fps: u32, sink: UpdateSink) -> Result<LiveCapture, LiveError> {
    let stats = Arc::new(Mutex::new(LiveStats::default()));
    let flags = Flags {
        min_interval: Duration::from_micros(1_000_000 / u64::from(fps.max(1))),
        sink: Arc::new(Mutex::new(sink)),
        stats: stats.clone(),
    };

    let (kind, raw) = source_id.split_once(':').ok_or_else(|| LiveError::BadSource(source_id.into()))?;
    let handle: u64 = raw.parse().map_err(|_| LiveError::BadSource(source_id.into()))?;

    let control = match kind {
        "window" => {
            let window = Window::from_raw_hwnd(handle as usize as *mut std::ffi::c_void);
            Handler::start_free_threaded(settings_for(window, flags)).map_err(|e| LiveError::Start(e.to_string()))?
        }
        "screen" => {
            let monitor = Monitor::from_raw_hmonitor(handle as usize as *mut std::ffi::c_void);
            Handler::start_free_threaded(settings_for(monitor, flags)).map_err(|e| LiveError::Start(e.to_string()))?
        }
        _ => return Err(LiveError::BadSource(source_id.into())),
    };

    Ok(LiveCapture { control: Some(control), stats })
}

/// Primary monitor's source id, for quick starts and demos.
pub fn primary_screen_id() -> Option<String> {
    let m = Monitor::primary().ok()?;
    Some(format!("screen:{}", m.as_raw_hmonitor() as usize))
}
