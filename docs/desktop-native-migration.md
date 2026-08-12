# NCore native desktop migration

NCore is moving from Electron to a Tauri v2 Windows client. Tauri uses the
system WebView2 runtime instead of bundling Chromium, reducing installer size
and removing a large, independent browser-update surface.

## What is already native

- A Tauri v2 Windows shell with one-instance behavior.
- Native external-link handling through the OS opener.
- Native notification and durable-store plugins, ready for the renderer ports.
- Supabase desktop sessions stored in Windows Credential Manager, rather than
  WebView localStorage.
- Desktop runtime detection, so the desktop uses hash routing and does not
  register the browser PWA service worker.

## Cutover rule

Electron remains the production desktop release until the Tauri build passes
these workflows on a clean Windows account: sign in/recovery, direct and
community messaging, calls and screen share, notifications, encrypted session
storage, external links, update download/install, start-on-login, and tray
background behavior.

## Remaining parity work

- Publish signed Tauri updater metadata and migrate the existing update feed
  from `latest.yml` to Tauri's signed updater manifest.
- Establish a protected release-signing key. The minisign key matching the
  `pubkey` in `src-tauri/tauri.conf.json` (`RWQYBQQF+g5D2GgG...`) is not on the
  build machine — `~/.tauri` holds `nyptid-bridge` and
  `nyptid-studio-updater`, neither of which matches — so signed Tauri updates
  cannot currently be published at all. The signing *password* is available via
  Credential Manager (`com.nyptid.ncore.release` /
  `tauri-updater-signing-password`) and the Rust toolchain is present, so the
  private key is the only missing piece.

  **Correction (2026-07-30):** the artifact-host half of this item was wrong.
  Vercel's "File size limit exceeded (100 MB)" was not caused by the installer;
  it was `src-tauri/target`, 5.7 GB containing a 140 MiB `.rlib`, which nothing
  excluded from the deploy payload. With that in `.vercelignore` the ~99 MB
  installer uploads without complaint and is served from
  ncore.nyptidindustries.com today. No separate artifact host is needed.
- Port the custom desktop capture source picker; until then, use WebView2's
  normal `getDisplayMedia` chooser.
- Port background realtime notification delivery and streamer-mode controls.

No Electron files are removed until those checks are complete and a staged
native release has been tested.
