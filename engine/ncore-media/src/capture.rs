//! Native capture-source enumeration with thumbnails.
//!
//! Lists shareable windows and monitors and renders a small JPEG thumbnail of
//! each, so the app can show its own Discord-style picker instead of the
//! WebView2 browser dialog ("Choose what to share with http://tauri.localhost").

use base64::Engine as _;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    /// Stable id: "window:<id>" or "screen:<id>".
    pub id: String,
    pub name: String,
    /// "window" | "screen"
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub app_name: Option<String>,
    pub width: u32,
    pub height: u32,
    /// `data:image/jpeg;base64,...`, empty if the thumbnail failed.
    pub thumbnail_data_url: String,
}

const THUMB_W: u32 = 320;

fn thumbnail(img: &image::RgbaImage) -> String {
    if img.width() == 0 || img.height() == 0 {
        return String::new();
    }
    let h = ((THUMB_W as f64 / img.width() as f64) * img.height() as f64).round().max(1.0) as u32;
    let small = image::imageops::resize(img, THUMB_W, h, image::imageops::FilterType::Triangle);
    let rgb = image::DynamicImage::ImageRgba8(small).to_rgb8();
    let mut jpeg = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 72);
    if enc.encode_image(&rgb).is_err() {
        return String::new();
    }
    format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg))
}

/// Enumerate shareable sources. Minimized, untitled and tiny windows are
/// skipped (they are tool windows, tray stubs and invisible helpers), as is
/// the caller's own process window when `exclude_pid` is given.
pub fn list_sources(exclude_pid: Option<u32>) -> Vec<CaptureSource> {
    let mut out = Vec::new();

    if let Ok(monitors) = xcap::Monitor::all() {
        for (i, m) in monitors.into_iter().enumerate() {
            let id = m.id().unwrap_or(i as u32);
            let name = m.name().unwrap_or_else(|_| format!("Screen {}", i + 1));
            let (width, height) = (m.width().unwrap_or(0), m.height().unwrap_or(0));
            let thumb = m.capture_image().map(|img| thumbnail(&img)).unwrap_or_default();
            out.push(CaptureSource {
                id: format!("screen:{id}"),
                name: if name.trim().is_empty() { format!("Screen {}", i + 1) } else { name },
                kind: "screen",
                app_name: None,
                width,
                height,
                thumbnail_data_url: thumb,
            });
        }
    }

    if let Ok(windows) = xcap::Window::all() {
        for w in windows {
            if w.is_minimized().unwrap_or(true) {
                continue;
            }
            let title = w.title().unwrap_or_default();
            if title.trim().is_empty() {
                continue;
            }
            if let (Some(skip), Ok(pid)) = (exclude_pid, w.pid()) {
                if pid == skip {
                    continue;
                }
            }
            let (width, height) = (w.width().unwrap_or(0), w.height().unwrap_or(0));
            if width < 120 || height < 80 {
                continue;
            }
            let Ok(id) = w.id() else { continue };
            let thumb = w.capture_image().map(|img| thumbnail(&img)).unwrap_or_default();
            out.push(CaptureSource {
                id: format!("window:{id}"),
                name: title,
                kind: "window",
                app_name: w.app_name().ok().filter(|s| !s.is_empty()),
                width,
                height,
                thumbnail_data_url: thumb,
            });
        }
    }

    out
}
