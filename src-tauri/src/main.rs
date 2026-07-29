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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            secure_storage_get,
            secure_storage_set,
            secure_storage_remove,
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .run(tauri::generate_context!())
        .expect("error while running NCore");
}
