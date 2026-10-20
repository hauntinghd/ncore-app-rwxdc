#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;
use serde::Serialize;
use tauri::Manager;

const CREDENTIAL_SERVICE: &str = "com.nyptid.ncore.desktop";
const CREDENTIAL_ACCOUNT: &str = "supabase-session";
const AUTH_STORAGE_KEY: &str = "ncore-auth";

#[derive(Serialize)]
struct SecureStorageResult {
    ok: bool,
    value: Option<String>,
    message: Option<String>,
}

fn credential_for(key: &str) -> Result<Entry, String> {
    if key != AUTH_STORAGE_KEY {
        return Err("Unsupported secure storage key".to_string());
    }
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .map_err(|error| format!("Windows Credential Manager is unavailable: {error}"))
}

#[tauri::command]
fn secure_storage_get(key: String) -> SecureStorageResult {
    let entry = match credential_for(&key) {
        Ok(entry) => entry,
        Err(message) => return SecureStorageResult { ok: false, value: None, message: Some(message) },
    };

    match entry.get_password() {
        Ok(value) => SecureStorageResult { ok: true, value: Some(value), message: None },
        // A missing credential is a normal first-run state. Any other failure
        // is reported so the renderer can retain its safe fallback instead of
        // silently overwriting a session.
        Err(keyring::Error::NoEntry) => SecureStorageResult { ok: true, value: None, message: None },
        Err(error) => SecureStorageResult { ok: false, value: None, message: Some(error.to_string()) },
    }
}

#[tauri::command]
fn secure_storage_set(key: String, value: String) -> SecureStorageResult {
    let entry = match credential_for(&key) {
        Ok(entry) => entry,
        Err(message) => return SecureStorageResult { ok: false, value: None, message: Some(message) },
    };

    match entry.set_password(&value) {
        Ok(()) => SecureStorageResult { ok: true, value: None, message: None },
        Err(error) => SecureStorageResult { ok: false, value: None, message: Some(error.to_string()) },
    }
}

#[tauri::command]
fn secure_storage_remove(key: String) -> SecureStorageResult {
    let entry = match credential_for(&key) {
        Ok(entry) => entry,
        Err(message) => return SecureStorageResult { ok: false, value: None, message: Some(message) },
    };

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => SecureStorageResult { ok: true, value: None, message: None },
        Err(error) => SecureStorageResult { ok: false, value: None, message: Some(error.to_string()) },
    }
}

/*
  WebView2 treats NCore's window like a web page and asks "tauri.localhost
  wants to use your microphone" the first time a call starts. A native app
  should not do that — Discord does not. Grant camera and microphone to our
  own app origin only; anything else keeps WebView2's default behaviour.
*/
#[cfg(windows)]
fn grant_own_origin_media_permissions(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        };
        use webview2_com::PermissionRequestedEventHandler;

        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut uri = windows::core::PWSTR::null();
            args.Uri(&mut uri)?;
            let uri = webview2_com::take_pwstr(uri);
            let own_origin = uri.starts_with("http://tauri.localhost")
                || uri.starts_with("https://tauri.localhost");
            if !own_origin {
                return Ok(());
            }
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_PermissionRequested(&handler, &mut token);
    });
}

fn main() {
    tauri::Builder::default()
        // single-instance must be registered before deep-link: on Windows an
        // ncore:// link launches a second process, and the deep-link feature
        // forwards that URL to the running instance instead of opening a new
        // window. That is how Google sign-in returns from the system browser.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            secure_storage_get,
            secure_storage_set,
            secure_storage_remove,
        ])
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                grant_own_origin_media_permissions(&window);
            }
            // Installed builds register ncore:// via the NSIS installer; this
            // covers dev runs and portable copies so the scheme always points
            // at the binary actually running.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running NCore");
}
