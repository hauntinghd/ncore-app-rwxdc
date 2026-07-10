# NCore native desktop migration

NCore is moving from Electron to a Tauri v2 Windows client. Tauri uses the
system WebView2 runtime instead of bundling Chromium, reducing installer size
and removing a large, independent browser-update surface.

## What is already native

- A Tauri v2 Windows shell with one-instance behavior.
- Native external-link handling through the OS opener.
- Native notification and durable-store plugins, ready for the renderer ports.
- Desktop runtime detection, so the desktop uses hash routing and does not
  register the browser PWA service worker.

## Cutover rule

Electron remains the production desktop release until the Tauri build passes
these workflows on a clean Windows account: sign in/recovery, direct and
community messaging, calls and screen share, notifications, encrypted session
storage, external links, update download/install, start-on-login, and tray
background behavior.

## Remaining parity work

- Move auth persistence to Tauri Stronghold rather than browser storage.
- Publish signed Tauri updater metadata and migrate the existing update feed
  from `latest.yml` to Tauri's signed updater manifest.
- Port the custom desktop capture source picker; until then, use WebView2's
  normal `getDisplayMedia` chooser.
- Port background realtime notification delivery and streamer-mode controls.

No Electron files are removed until those checks are complete and a staged
native release has been tested.
