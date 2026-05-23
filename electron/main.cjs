const path = require('path');
const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  shell,
  Notification,
  desktopCapturer,
  Tray,
  Menu,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
let _realtimeClient = null;
let _realtimeChannel = null;
let _profileStatusChannel = null;
let _currentUserId = null;
let _currentUserStatus = 'online';
let _streamerModeConfig = {
  enabled: false,
  hideDmPreviews: true,
  silentNotifications: true,
};
let _preferredDesktopSourceId = null;
let mainWindow = null;
let updateOverlayWindow = null;
let cachedLogoDataUri = null;
let appTray = null;
let isAppQuitting = false;
let isInstallingUpdate = false;
let hasShownBackgroundHint = false;
const PRIMARY_UPDATE_FEED_URL = 'https://ncore.nyptidindustries.com/updates';
const isPortableBuild = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
let isUpdateReady = false;
let downloadedUpdateVersion = '';
let availableUpdateVersion = '';
let isCheckingForUpdate = false;
let isDownloadingUpdate = false;
let updateDownloadProgress = 0;
let updateStatusMessage = '';
let autoUpdateCheckPromise = null;

function getUpdateRuntimeState() {
  return {
    ok: true,
    portable: isPortableBuild,
    ready: isUpdateReady,
    installing: isInstallingUpdate,
    checking: isCheckingForUpdate,
    downloading: isDownloadingUpdate,
    progress: Number.isFinite(updateDownloadProgress) ? Number(updateDownloadProgress) : 0,
    version: String(downloadedUpdateVersion || availableUpdateVersion || ''),
    latestVersion: String(availableUpdateVersion || downloadedUpdateVersion || ''),
    message: String(updateStatusMessage || ''),
  };
}

function emitUpdateReadyState() {
  const payload = getUpdateRuntimeState();
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.webContents.send('updates:ready', payload);
    } catch {
      // ignore renderer event delivery failures
    }
  }
  pushUpdateOverlayState();
}

// ---------------------------------------------------------------------------
// Update overlay (Discord-style frameless "arc reactor" window)
// ---------------------------------------------------------------------------

let updateOverlayErrorState = null; // { title, message, hint, downloadUrl, revealPath } | null

function getUpdateOverlayPhase() {
  if (updateOverlayErrorState) return 'error';
  if (isInstallingUpdate) return 'installing';
  if (isUpdateReady) return 'ready';
  if (isDownloadingUpdate) return 'downloading';
  if (isCheckingForUpdate) return 'checking';
  return 'idle';
}

function buildUpdateOverlayState() {
  const base = {
    phase: getUpdateOverlayPhase(),
    progress: Number.isFinite(updateDownloadProgress) ? Number(updateDownloadProgress) : 0,
    version: String(downloadedUpdateVersion || availableUpdateVersion || ''),
    message: String(updateStatusMessage || ''),
    installing: isInstallingUpdate,
    ready: isUpdateReady,
    downloading: isDownloadingUpdate,
    checking: isCheckingForUpdate,
  };
  if (updateOverlayErrorState) {
    return { ...base, ...updateOverlayErrorState };
  }
  return base;
}

function getPendingInstallerPath() {
  try {
    // electron-updater stores downloaded installers under %LOCALAPPDATA% on
    // Windows (NOT %APPDATA% / userData). Computing this from app.getPath
    // ('userData') + '..' resolves to Roaming, which is the wrong drive root,
    // so the preflight always concluded the installer was missing and bailed
    // out via pushOverlayInstallerMissing — even when the real installer was
    // sitting in the correct LocalAppData folder ready to run.
    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA
        || path.join(app.getPath('home'), 'AppData', 'Local');
      return path.join(localAppData, 'ncore-updater', 'pending');
    }
    return path.join(app.getPath('userData'), '..', 'ncore-updater', 'pending');
  } catch {
    return '';
  }
}

function resolveUpdateDownloadUrl() {
  const feed = readUpdateFeedUrl();
  if (!feed) return '';
  // The installer filename varies by version. Link to the directory listing
  // so users can grab whatever latest.yml points at.
  return feed.replace(/\/$/, '') + '/';
}

function ensureUpdateOverlay() {
  if (isPortableBuild) return null;
  if (updateOverlayWindow && !updateOverlayWindow.isDestroyed()) {
    updateOverlayWindow.show();
    return updateOverlayWindow;
  }
  try {
    updateOverlayWindow = new BrowserWindow({
      width: 420,
      height: 440,
      resizable: false,
      minimizable: true,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      backgroundColor: '#00000000',
      title: 'Updating NCore',
      icon: resolveAppIconPath() || undefined,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'update-overlay-preload.cjs'),
      },
    });
    updateOverlayWindow.setMenuBarVisibility(false);
    updateOverlayWindow.loadFile(path.join(__dirname, 'update-overlay.html'));
    updateOverlayWindow.once('ready-to-show', () => {
      if (updateOverlayWindow && !updateOverlayWindow.isDestroyed()) {
        updateOverlayWindow.show();
      }
    });
    updateOverlayWindow.on('closed', () => {
      updateOverlayWindow = null;
    });
  } catch (error) {
    console.warn('Failed to open update overlay window:', error?.message || error);
    updateOverlayWindow = null;
  }
  return updateOverlayWindow;
}

function pushUpdateOverlayState() {
  if (!updateOverlayWindow || updateOverlayWindow.isDestroyed()) return;
  try {
    updateOverlayWindow.webContents.send('updateOverlay:state', buildUpdateOverlayState());
  } catch {
    // ignore — overlay may still be loading
  }
}

function closeUpdateOverlay() {
  if (!updateOverlayWindow) return;
  try {
    if (!updateOverlayWindow.isDestroyed()) updateOverlayWindow.close();
  } catch {
    // ignore
  }
  updateOverlayWindow = null;
}

function pushOverlayInstallerMissing() {
  const version = downloadedUpdateVersion || availableUpdateVersion || '';
  const feed = resolveUpdateDownloadUrl();
  const pendingDir = getPendingInstallerPath();
  updateOverlayErrorState = {
    title: 'Installer was blocked',
    message: version
      ? `The NCore v${version} installer was downloaded, but Windows (usually Defender or SmartScreen) removed it before we could run it.`
      : 'The installer was downloaded, but Windows removed it before we could run it.',
    hint: 'Whitelist the ncore-updater folder under Windows Security → Virus & threat protection → Exclusions to keep this from happening.',
    downloadUrl: feed,
    revealPath: pendingDir,
  };
  isInstallingUpdate = false;
  isUpdateReady = false;
  emitUpdateReadyState();
  ensureUpdateOverlay();
  return { ok: false, ...updateOverlayErrorState };
}

function pushOverlayInstallError(error) {
  const feed = resolveUpdateDownloadUrl();
  const pendingDir = getPendingInstallerPath();
  const rawMessage = String(error?.message || error || 'Unknown install error.');
  const looksLikeMissing = /cannot find|not found|ENOENT|no such file/i.test(rawMessage);
  updateOverlayErrorState = {
    title: looksLikeMissing ? 'Installer was blocked' : 'Install failed',
    message: looksLikeMissing
      ? 'Windows (usually Defender or SmartScreen) blocked the installer. Download the latest build manually to finish updating.'
      : rawMessage,
    hint: looksLikeMissing
      ? 'Whitelist the ncore-updater folder under Windows Security → Virus & threat protection → Exclusions to keep this from happening.'
      : '',
    downloadUrl: feed,
    revealPath: pendingDir,
  };
  isInstallingUpdate = false;
  emitUpdateReadyState();
  ensureUpdateOverlay();
  return { ok: false, ...updateOverlayErrorState };
}

function readAppLogoDataUri() {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const candidates = [
    path.join(__dirname, 'assets', 'NCore.jpg'),
    path.join(__dirname, '..', 'public', 'NCore.jpg'),
    path.join(__dirname, '..', 'dist', 'NCore.jpg'),
    path.join(process.resourcesPath || __dirname, 'NCore.jpg'),
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const buf = fs.readFileSync(candidate);
      const ext = path.extname(candidate).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg';
      cachedLogoDataUri = `data:${mime};base64,${buf.toString('base64')}`;
      return cachedLogoDataUri;
    } catch {
      // try next candidate
    }
  }
  return '';
}

// Keep media/playback responsive for realtime calling.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('NCore');
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('com.nyptid.ncore');
  } catch {
    // ignore app model id failures on unsupported runtimes
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  const appIconPath = resolveAppIconPath();
  const isWindows = process.platform === 'win32';

  mainWindow = new BrowserWindow({
    width: 1400,
      height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    icon: appIconPath,
    ...(isWindows ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#11131a',
        symbolColor: '#f4f6fb',
        height: 32,
      },
    } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  if (appIconPath && typeof mainWindow.setIcon === 'function') {
    mainWindow.setIcon(appIconPath);
  }

  mainWindow.on('close', (event) => {
    if (isAppQuitting || isInstallingUpdate) return;
    event.preventDefault();
    mainWindow?.hide();
    showBackgroundRunningHint();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.info('[renderer] did-finish-load');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[renderer] did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] render-process-gone', details);
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (!message) return;
    console.log('[renderer:console]', { level, message, line, sourceId });
  });

  const htmlPath = path.join(__dirname, '..', 'dist', 'index.html');
  mainWindow.loadFile(htmlPath);
  return mainWindow;
}

function resolveAppIconPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'ncore-icon.ico'),
    path.join(__dirname, '..', 'build', 'ncore-icon.ico'),
    path.join(__dirname, 'assets', 'ncore-icon.ico'),
    path.join(__dirname, '..', 'build', 'ncore-icon.png'),
    path.join(__dirname, '..', 'public', 'ncore-logo.png'),
    path.join(__dirname, '..', 'dist', 'ncore-logo.png'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore candidate lookup errors
    }
  }
  return undefined;
}

function getWindowCaptureTitles() {
  return BrowserWindow.getAllWindows()
    .filter((win) => win && !win.isDestroyed())
    .map((win) => String(win.getTitle() || '').trim().toLowerCase())
    .filter(Boolean);
}

function isOwnWindowCaptureSource(source, knownTitles = getWindowCaptureTitles()) {
  if (!source) return false;
  const sourceId = String(source.id || '').trim().toLowerCase();
  const sourceName = String(source.name || '').trim().toLowerCase();
  if (!sourceId.startsWith('window:')) return false;
  if (!sourceName) return false;
  if (sourceName.includes('ncore') || sourceName.includes('nyptid')) return true;
  return knownTitles.some((title) => (
    title
    && (sourceName === title || sourceName.includes(title) || title.includes(sourceName))
  ));
}

function filterDesktopCaptureSources(sources) {
  const sourceList = Array.isArray(sources) ? sources : [];
  const windowTitles = getWindowCaptureTitles();
  const filtered = sourceList.filter((source) => !isOwnWindowCaptureSource(source, windowTitles));
  const preferred = filtered.length > 0 ? filtered : sourceList;
  return [...preferred].sort((left, right) => {
    const leftIsScreen = String(left?.id || '').startsWith('screen:');
    const rightIsScreen = String(right?.id || '').startsWith('screen:');
    if (leftIsScreen === rightIsScreen) return 0;
    return leftIsScreen ? -1 : 1;
  });
}

function showMainWindow() {
  const win = createWindow();
  if (!win) return null;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  return win;
}

function isRendererInForeground() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  try {
    return mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused();
  } catch {
    return false;
  }
}

function destroyTray() {
  if (!appTray) return;
  try {
    appTray.destroy();
  } catch {
    // ignore tray teardown failures
  }
  appTray = null;
}

function closeAllWindows(options = {}) {
  const force = Boolean(options.force);
  const keepOverlay = Boolean(options.keepOverlay);
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win || win.isDestroyed()) continue;
    // The Discord-style update overlay is the one surface we want to survive
    // the quit-for-update flow so users see the arc-reactor animation during
    // install. closeAllWindows callers that want a hard reset pass force:true.
    if (keepOverlay && updateOverlayWindow && win === updateOverlayWindow) continue;
    try {
      win.removeAllListeners('close');
    } catch {
      // ignore listener cleanup failures
    }
    if (force) {
      try {
        win.destroy();
      } catch {
        // ignore forced window destroy failures
      }
      continue;
    }
    try {
      win.close();
    } catch {
      // ignore window close failures
    }
  }
}

function triggerUpdateInstall(reason = 'auto') {
  if (isInstallingUpdate) return;
  isInstallingUpdate = true;
  isUpdateReady = false;
  isAppQuitting = true;
  hasShownBackgroundHint = true;

  // Show the arc-reactor overlay FIRST so the user sees the animation the
  // moment they click the green update button — not just when
  // before-quit-for-update happens to fire later in the tear-down.
  updateStatusMessage = downloadedUpdateVersion
    ? `Installing NCore v${downloadedUpdateVersion}...`
    : 'Installing update...';
  ensureUpdateOverlay();
  emitUpdateReadyState();
  destroyTray();

  // Preflight: if Defender / SmartScreen already ate the pending installer,
  // bail out before NSIS so we can show a proper recovery UI instead of
  // flashing the install animation for half a second and dying.
  try {
    const pendingDir = getPendingInstallerPath();
    if (pendingDir && fs.existsSync(pendingDir)) {
      const hasInstaller = fs.readdirSync(pendingDir).some((name) => /\.exe$/i.test(name));
      if (!hasInstaller) {
        isAppQuitting = false;
        isInstallingUpdate = false;
        pushOverlayInstallerMissing();
        return;
      }
    }
  } catch {
    // if we can't read the pending dir, fall through and let autoUpdater try.
  }

  // Hide the main window (and any secondary) but keep the overlay alive so
  // the animation stays on screen through the quit handoff to NSIS.
  closeAllWindows({ keepOverlay: true });

  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      console.warn(`quitAndInstall failed (${reason}):`, error?.message || error);
      pushOverlayInstallError(error);
      closeAllWindows({ force: true, keepOverlay: true });
      try {
        app.quit();
      } catch {
        // ignore quit fallback failures
      }
    }
  }, 250);

  // Fallback: if the app is still alive after quitAndInstall attempt, force exit.
  setTimeout(() => {
    if (!isInstallingUpdate) return;
    // At this point NSIS should have already taken over. If not, force-close
    // everything — the overlay included, since leaving it behind orphaned
    // would look worse than a clean shutdown.
    closeAllWindows({ force: true });
    try {
      app.quit();
    } catch {
      // ignore quit fallback failures
    }
    setTimeout(() => {
      try {
        app.exit(0);
      } catch {
        // ignore hard-exit failures
      }
    }, 1500);
  }, 12000);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Open NCore',
      click: () => {
        showMainWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isAppQuitting = true;
        app.quit();
      },
    },
  ]);
}

function ensureTray() {
  if (appTray) return;
  const iconPath = resolveAppIconPath();
  if (!iconPath) return;
  appTray = new Tray(iconPath);
  appTray.setToolTip('NCore');
  appTray.setContextMenu(buildTrayMenu());
  appTray.on('click', () => {
    showMainWindow();
  });
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase() || 'online';
}

function shouldSilenceDesktopNotification() {
  if (normalizeStatus(_currentUserStatus) === 'dnd') return true;
  return Boolean(_streamerModeConfig.enabled && _streamerModeConfig.silentNotifications);
}

function shouldHideDesktopPreview(type) {
  if (!_streamerModeConfig.enabled || !_streamerModeConfig.hideDmPreviews) return false;
  const normalizedType = String(type || '').trim().toLowerCase();
  return normalizedType === 'direct_message'
    || normalizedType === 'mention'
    || normalizedType === 'incoming_call';
}

function buildNotificationPresentation(incoming) {
  const type = String(incoming?.type || '').trim().toLowerCase();
  const fallbackTitle = 'NCore';
  const fallbackBody = '';
  const title = String(incoming?.title || fallbackTitle);
  const body = String(incoming?.body || fallbackBody);
  if (!shouldHideDesktopPreview(type)) {
    return { title, body, type };
  }
  if (type === 'incoming_call') {
    return { title: 'Incoming call', body: 'Call details hidden in Streamer Mode.', type };
  }
  if (type === 'mention') {
    return { title: 'New mention', body: 'Message preview hidden in Streamer Mode.', type };
  }
  return { title: 'New notification', body: 'Message preview hidden in Streamer Mode.', type };
}

function playIncomingCallDing() {
  // A short multi-beep pattern feels more call-like than a single chime.
  if (shouldSilenceDesktopNotification()) return;
  const intervals = [0, 220, 460, 760, 1080];
  intervals.forEach((delayMs) => {
    setTimeout(() => {
      try {
        shell.beep();
      } catch {
        // ignore beep failures
      }
    }, delayMs);
  });
}

function playMessageDing() {
  if (shouldSilenceDesktopNotification()) return;
  [0, 150].forEach((delayMs) => {
    setTimeout(() => {
      try {
        shell.beep();
      } catch {
        // ignore beep failures
      }
    }, delayMs);
  });
}

function playMentionDing() {
  if (shouldSilenceDesktopNotification()) return;
  [0, 110, 230].forEach((delayMs) => {
    setTimeout(() => {
      try {
        shell.beep();
      } catch {
        // ignore beep failures
      }
    }, delayMs);
  });
}

function showBackgroundRunningHint() {
  if (hasShownBackgroundHint) return;
  hasShownBackgroundHint = true;
  if (shouldSilenceDesktopNotification()) return;
  try {
    const notification = new Notification({
      title: 'NCore is still running',
      body: 'You will keep receiving message and call notifications in the background.',
      silent: false,
      icon: resolveAppIconPath(),
    });
    notification.show();
  } catch {
    // ignore unsupported notification errors
  }
}

function showNativeNotificationForEvent(incoming) {
  if (shouldSilenceDesktopNotification()) return;
  const presentation = buildNotificationPresentation(incoming);
  const title = presentation.title;
  const body = presentation.body;
  const type = presentation.type;

  const notification = new Notification({
    title,
    body,
    silent: false,
    icon: resolveAppIconPath(),
  });

  notification.on('click', () => {
    const win = showMainWindow();
    if (!win) return;
    const payload = {
      type,
      data: incoming?.data || {},
    };
    win.webContents.send('desktop-notification-click', payload);
    if (type === 'incoming_call') {
      win.webContents.send('incoming-call', incoming?.data || {});
    }
  });

  notification.show();
}

app.whenReady().then(() => {
  applyStartupConfig(readStartupConfig());

  registerDesktopActions();

  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    if (
      permission === 'media'
      || permission === 'microphone'
      || permission === 'camera'
      || permission === 'display-capture'
    ) {
      return true;
    }
    return false;
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (
      permission === 'media'
      || permission === 'microphone'
      || permission === 'camera'
      || permission === 'display-capture'
    ) {
      callback(true);
      return;
    }
    callback(false);
  });

  // Electron desktop capture bridge. Without this handler some runtimes reject
  // getDisplayMedia/createScreenVideoTrack with NOT_SUPPORTED.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const rawSources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        fetchWindowIcons: true,
      });
      const sources = filterDesktopCaptureSources(rawSources);

      if (!sources || sources.length === 0) {
        callback({ video: null, audio: null });
        return;
      }

      const preferredSource = _preferredDesktopSourceId
        ? sources.find((source) => String(source.id) === String(_preferredDesktopSourceId))
        : null;
      const selectedSource = preferredSource || sources[0];
      _preferredDesktopSourceId = null;

      callback({
        video: selectedSource,
        audio: 'loopback',
      });
    } catch (error) {
      console.warn('Display media request failed:', error);
      callback({ video: null, audio: null });
    }
  }, {
    useSystemPicker: false,
  });

  createWindow();
  ensureTray();
  setupAutoUpdates();

  app.on('activate', () => {
    showMainWindow();
  });
});

// Keep the app process running in background so desktop clients can receive incoming-call
// notifications and ring even when the main window is closed. We will not quit on window close.
app.on('window-all-closed', () => {
  if (!isAppQuitting && !isInstallingUpdate) return;
  app.quit();
});

app.on('before-quit', () => {
  isAppQuitting = true;
  if (isInstallingUpdate) {
    destroyTray();
  }
});

// IPC for starting/stopping background realtime listeners from renderer
ipcMain.handle('realtime:start', async (_event, accessToken) => {
  try {
    if (!accessToken) return { ok: false, message: 'Missing access token' };
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) return { ok: false, message: 'Missing SUPABASE env' };

    // Create a client that uses the provided access token to identify the user.
    _realtimeClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      realtime: { params: { eventsPerSecond: 10 } },
    });

    // Resolve user id
    const { data: userData } = await _realtimeClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return { ok: false, message: 'Unable to determine user id' };
    _currentUserId = userId;

    if (_realtimeChannel) {
      _realtimeClient.removeChannel(_realtimeChannel);
      _realtimeChannel = null;
    }
    if (_profileStatusChannel) {
      _realtimeClient.removeChannel(_profileStatusChannel);
      _profileStatusChannel = null;
    }

    // Prime user status so DND users are not pinged from desktop process.
    const { data: statusRow } = await _realtimeClient
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .maybeSingle();
    _currentUserStatus = normalizeStatus(statusRow?.status || 'online');

    _profileStatusChannel = _realtimeClient
      .channel(`profile-status:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          const next = payload?.new?.status;
          _currentUserStatus = normalizeStatus(next || _currentUserStatus);
        },
      )
      .subscribe();

    // Subscribe to notifications for this user.
    _realtimeChannel = _realtimeClient
      .channel(`notifications:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
        try {
          const incoming = payload.new || {};
          if (normalizeStatus(_currentUserStatus) === 'dnd') {
            return;
          }
          if (isRendererInForeground()) {
            return;
          }
          showNativeNotificationForEvent(incoming);
          if (incoming.type === 'incoming_call') {
            playIncomingCallDing();
          } else if (incoming.type === 'mention' || Boolean(incoming?.data?.mention)) {
            playMentionDing();
          } else {
            playMessageDing();
          }
        } catch (err) {
          console.warn('Notification handler error', err);
        }
      })
      .subscribe();

    return { ok: true };
  } catch (err) {
    console.error('realtime:start error', err);
    return { ok: false, message: String(err?.message || err) };
  }
});

ipcMain.handle('realtime:stop', async () => {
  try {
    if (_realtimeChannel && _realtimeClient) {
      _realtimeClient.removeChannel(_realtimeChannel);
      _realtimeChannel = null;
    }
    if (_profileStatusChannel && _realtimeClient) {
      _realtimeClient.removeChannel(_profileStatusChannel);
      _profileStatusChannel = null;
    }
    _realtimeClient = null;
    _currentUserId = null;
    _currentUserStatus = 'online';
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err?.message || err) };
  }
});

ipcMain.handle('realtime:setStatus', async (_event, payload) => {
  _currentUserStatus = normalizeStatus(payload?.status || _currentUserStatus);
  return { ok: true };
});

ipcMain.handle('settings:setStreamerMode', async (_event, payload) => {
  _streamerModeConfig = {
    enabled: Boolean(payload?.enabled),
    hideDmPreviews: payload?.hideDmPreviews === undefined ? true : Boolean(payload?.hideDmPreviews),
    silentNotifications: payload?.silentNotifications === undefined ? true : Boolean(payload?.silentNotifications),
  };
  return { ok: true };
});

function setupAutoUpdates() {
  if (isPortableBuild) {
    // electron-updater does not support true auto-install flow on portable target.
    updateStatusMessage = 'Auto-update is unavailable on portable builds. Install NCore Setup to get self-updating releases.';
    console.warn('Auto-update disabled for portable build. Use NSIS build for automatic updates.');
    emitUpdateReadyState();
    return;
  }

  const updateFeedUrl = readUpdateFeedUrl();
  if (updateFeedUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: updateFeedUrl });
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    isCheckingForUpdate = true;
    isDownloadingUpdate = false;
    isUpdateReady = false;
    updateDownloadProgress = 0;
    updateOverlayErrorState = null;
    updateStatusMessage = 'Checking for updates...';
    emitUpdateReadyState();
  });

  autoUpdater.on('error', (err) => {
    isCheckingForUpdate = false;
    isDownloadingUpdate = false;
    updateStatusMessage = String(err?.message || err || 'Update check failed.');
    updateDownloadProgress = 0;
    autoUpdateCheckPromise = null;
    emitUpdateReadyState();
    console.warn('Auto-update check skipped or failed:', err?.message || err);
  });

  autoUpdater.on('before-quit-for-update', () => {
    isCheckingForUpdate = false;
    isDownloadingUpdate = false;
    isUpdateReady = false;
    isInstallingUpdate = true;
    isAppQuitting = true;
    updateStatusMessage = downloadedUpdateVersion
      ? `Applying NCore v${downloadedUpdateVersion}...`
      : 'Applying update...';
    // The overlay is the only window that survives quitAndInstall to give the
    // user a "we're working on it" surface during the brief window between
    // the main app quitting and NSIS relaunching the new exe.
    ensureUpdateOverlay();
    emitUpdateReadyState();
    destroyTray();
  });

  autoUpdater.on('update-available', (info) => {
    isCheckingForUpdate = false;
    isDownloadingUpdate = true;
    isUpdateReady = false;
    downloadedUpdateVersion = '';
    availableUpdateVersion = normalizeSemver(info?.version || info?.releaseName || '');
    updateDownloadProgress = 0;
    updateStatusMessage = availableUpdateVersion
      ? `Downloading NCore v${availableUpdateVersion}...`
      : 'Downloading update...';
    ensureUpdateOverlay();
    emitUpdateReadyState();
  });

  autoUpdater.on('update-not-available', (info) => {
    isCheckingForUpdate = false;
    isDownloadingUpdate = false;
    isUpdateReady = false;
    updateDownloadProgress = 0;
    availableUpdateVersion = '';
    downloadedUpdateVersion = normalizeSemver(info?.version || info?.releaseName || '') || downloadedUpdateVersion;
    updateStatusMessage = downloadedUpdateVersion
      ? `NCore is already on the latest build (v${downloadedUpdateVersion}).`
      : 'NCore is already on the latest build.';
    emitUpdateReadyState();
  });

  autoUpdater.on('download-progress', (progress) => {
    isCheckingForUpdate = false;
    isDownloadingUpdate = true;
    isUpdateReady = false;
    const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
    updateDownloadProgress = percent;
    updateStatusMessage = availableUpdateVersion
      ? `Downloading NCore v${availableUpdateVersion} (${percent}%)...`
      : `Downloading update (${percent}%)...`;
    emitUpdateReadyState();
  });

  autoUpdater.on('update-downloaded', (info) => {
    isCheckingForUpdate = false;
    isDownloadingUpdate = false;
    updateDownloadProgress = 100;
    downloadedUpdateVersion = normalizeSemver(info?.version || info?.releaseName || '') || availableUpdateVersion || downloadedUpdateVersion;
    availableUpdateVersion = downloadedUpdateVersion || availableUpdateVersion;
    isUpdateReady = true;
    updateStatusMessage = downloadedUpdateVersion
      ? `NCore v${downloadedUpdateVersion} is ready to install.`
      : 'Update downloaded and ready to install.';
    emitUpdateReadyState();
  });

  // Check on startup and periodically.
  void runAutoUpdaterCheck();
  setInterval(() => {
    void runAutoUpdaterCheck();
  }, 10 * 60 * 1000);
}

async function runAutoUpdaterCheck() {
  if (isPortableBuild) {
    return getUpdateRuntimeState();
  }
  if (isInstallingUpdate || isUpdateReady) {
    emitUpdateReadyState();
    return getUpdateRuntimeState();
  }
  if (!autoUpdateCheckPromise) {
    autoUpdateCheckPromise = autoUpdater.checkForUpdates()
      .catch((error) => {
        throw error;
      })
      .finally(() => {
        autoUpdateCheckPromise = null;
      });
  }
  try {
    await autoUpdateCheckPromise;
  } catch {
    // state is already reflected through the autoUpdater error event
  }
  return getUpdateRuntimeState();
}

function readUpdateFeedUrl() {
  const fromEnv = normalizeUpdateFeedUrl(String(process.env.NCORE_UPDATE_URL || process.env.CORDTY_UPDATE_URL || '').trim());
  if (fromEnv) return fromEnv;

  const userPath = getUserUpdateConfigPath();
  const fromUserConfig = normalizeUpdateFeedUrl(readUpdateUrlFromFile(userPath));
  if (fromUserConfig) return fromUserConfig;

  const bundledPath = path.join(__dirname, 'update-config.json');
  const fromBundled = normalizeUpdateFeedUrl(readUpdateUrlFromFile(bundledPath));
  return fromBundled || PRIMARY_UPDATE_FEED_URL;
}

function getUserUpdateConfigPath() {
  return path.join(app.getPath('userData'), 'update-config.json');
}

function getUpdateStatePath() {
  return path.join(app.getPath('userData'), 'update-state.json');
}

function getAuthStoragePath() {
  return path.join(app.getPath('userData'), 'auth-storage.json');
}

function getStartupConfigPath() {
  return path.join(app.getPath('userData'), 'startup-config.json');
}

function readStartupConfig() {
  try {
    const raw = fs.readFileSync(getStartupConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
    return {
      openAtLogin: Boolean(parsed.openAtLogin ?? true),
      openAsHidden: Boolean(parsed.openAsHidden ?? true),
    };
  } catch {
    // Default: start with Windows, minimized to tray. Matches the "always running" posture.
    return { openAtLogin: true, openAsHidden: true };
  }
}

function writeStartupConfig(nextConfig) {
  try {
    const current = readStartupConfig();
    const merged = {
      openAtLogin: typeof nextConfig?.openAtLogin === 'boolean' ? nextConfig.openAtLogin : current.openAtLogin,
      openAsHidden: typeof nextConfig?.openAsHidden === 'boolean' ? nextConfig.openAsHidden : current.openAsHidden,
    };
    fs.writeFileSync(getStartupConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (error) {
    console.warn('Failed to persist startup-config.json:', error?.message || error);
    return readStartupConfig();
  }
}

function applyStartupConfig(config) {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(config.openAtLogin),
      openAsHidden: Boolean(config.openAsHidden),
    });
  } catch (error) {
    console.warn('Failed to apply startup login item:', error?.message || error);
  }
}

function readUpdateState() {
  try {
    const statePath = getUpdateStatePath();
    if (!fs.existsSync(statePath)) return {};
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeUpdateState(nextState) {
  try {
    const statePath = getUpdateStatePath();
    const current = readUpdateState();
    const merged = { ...current, ...(nextState || {}) };
    fs.writeFileSync(statePath, JSON.stringify(merged, null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to persist update-state.json:', error?.message || error);
  }
}

function readAuthStorageState() {
  try {
    const statePath = getAuthStoragePath();
    if (!fs.existsSync(statePath)) return {};
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAuthStorageState(nextState) {
  try {
    const statePath = getAuthStoragePath();
    const current = readAuthStorageState();
    const merged = { ...current, ...(nextState || {}) };
    fs.writeFileSync(statePath, JSON.stringify(merged, null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to persist auth-storage.json:', error?.message || error);
  }
}

function readUpdateUrlFromFile(configPath) {
  try {
    if (!fs.existsSync(configPath)) return '';
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeUpdateFeedUrl(String(parsed.url || '').trim());
  } catch (error) {
    console.warn('Invalid update-config.json:', error?.message || error);
    return '';
  }
}

function normalizeUpdateFeedUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  const noHash = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  const normalizedPath = noHash.endsWith('/latest.yml') ? noHash.replace(/\/latest\.yml$/i, '') : noHash;
  return normalizedPath;
}

function isPrivateIpv4Host(hostname) {
  const match = String(hostname || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (first === 10 || first === 127) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  return false;
}

function registerDesktopActions() {
  ipcMain.handle('updateOverlay:getState', async () => buildUpdateOverlayState());
  ipcMain.handle('updateOverlay:getLogo', async () => readAppLogoDataUri());
  ipcMain.handle('updateOverlay:install', async () => {
    // Route through the shared triggerUpdateInstall() — it keeps the overlay
    // alive, does the Defender preflight, and handles all the cleanup paths.
    try {
      triggerUpdateInstall('overlay-install-now');
      return { ok: true };
    } catch (error) {
      return pushOverlayInstallError(error);
    }
  });
  ipcMain.handle('updateOverlay:dismiss', async () => {
    closeUpdateOverlay();
    return { ok: true };
  });
  ipcMain.handle('updateOverlay:retry', async () => {
    updateOverlayErrorState = null;
    updateStatusMessage = 'Re-checking for updates...';
    emitUpdateReadyState();
    try {
      await runAutoUpdaterCheck();
      return { ok: true };
    } catch (error) {
      return pushOverlayInstallError(error);
    }
  });
  ipcMain.handle('updateOverlay:openExternal', async (_event, payload) => {
    const url = String(payload?.url || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) return { ok: false };
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  });
  ipcMain.handle('updateOverlay:revealInFolder', async (_event, payload) => {
    const filePath = String(payload?.filePath || '').trim();
    if (!filePath) return { ok: false };
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        shell.openPath(filePath);
      } else {
        shell.showItemInFolder(filePath);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  });

  ipcMain.handle('startup:get', async () => {
    const config = readStartupConfig();
    let effective = config;
    if (app.isPackaged && process.platform === 'win32') {
      try {
        const live = app.getLoginItemSettings();
        effective = {
          openAtLogin: Boolean(live.openAtLogin),
          openAsHidden: Boolean(live.openAsHidden ?? config.openAsHidden),
        };
      } catch {
        // keep config as fallback
      }
    }
    return {
      ok: true,
      openAtLogin: effective.openAtLogin,
      openAsHidden: effective.openAsHidden,
      supported: app.isPackaged && process.platform === 'win32',
    };
  });

  ipcMain.handle('startup:set', async (_event, payload) => {
    try {
      const next = writeStartupConfig({
        openAtLogin: typeof payload?.openAtLogin === 'boolean' ? payload.openAtLogin : undefined,
        openAsHidden: typeof payload?.openAsHidden === 'boolean' ? payload.openAsHidden : undefined,
      });
      applyStartupConfig(next);
      return { ok: true, ...next, supported: app.isPackaged && process.platform === 'win32' };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  });

  ipcMain.handle('authStorage:getItem', async (_event, payload) => {
    try {
      const key = String(payload?.key || '').trim();
      if (!key) return { ok: false, message: 'Storage key is required.' };
      const storage = readAuthStorageState();
      const value = Object.prototype.hasOwnProperty.call(storage, key)
        ? String(storage[key] ?? '')
        : null;
      return { ok: true, value };
    } catch (error) {
      return { ok: false, value: null, message: String(error?.message || error) };
    }
  });

  ipcMain.handle('authStorage:setItem', async (_event, payload) => {
    try {
      const key = String(payload?.key || '').trim();
      if (!key) return { ok: false, message: 'Storage key is required.' };
      const value = String(payload?.value ?? '');
      writeAuthStorageState({ [key]: value });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  });

  ipcMain.handle('authStorage:removeItem', async (_event, payload) => {
    try {
      const key = String(payload?.key || '').trim();
      if (!key) return { ok: false, message: 'Storage key is required.' };
      const current = readAuthStorageState();
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        delete current[key];
        fs.writeFileSync(getAuthStoragePath(), JSON.stringify(current, null, 2), 'utf8');
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  });

  ipcMain.handle('shell:openExternal', async (_event, payload) => {
    try {
      const rawUrl = String(payload?.url || '').trim();
      if (!rawUrl) {
        return { ok: false, message: 'URL is required.' };
      }
      const parsed = new URL(rawUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        return { ok: false, message: 'Only http/https URLs are allowed.' };
      }
      if (parsed.username || parsed.password) {
        return { ok: false, message: 'Credential-style URLs are blocked.' };
      }
      const hostname = String(parsed.hostname || '').trim().toLowerCase();
      if (hostname === 'localhost' || isPrivateIpv4Host(hostname)) {
        return { ok: false, message: 'Private or local network links are blocked.' };
      }
      await shell.openExternal(parsed.toString());
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  });

  ipcMain.handle('desktopCapture:listSources', async () => {
    try {
      const rawSources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      const sources = filterDesktopCaptureSources(rawSources);

      const mapped = (sources || []).map((source) => ({
        id: String(source.id),
        name: String(source.name || 'Untitled'),
        type: source.id.startsWith('window:') ? 'window' : 'screen',
        thumbnailDataUrl: source.thumbnail?.isEmpty?.() ? '' : source.thumbnail?.toDataURL?.() || '',
      }));

      return { ok: true, sources: mapped };
    } catch (error) {
      return { ok: false, message: String(error?.message || error), sources: [] };
    }
  });

  ipcMain.handle('desktopCapture:setPreferredSource', async (_event, payload) => {
    const nextSourceId = String(payload?.sourceId || '').trim();
    _preferredDesktopSourceId = nextSourceId || null;
    return { ok: true };
  });

  ipcMain.handle('updates:getConfig', async () => {
    const url = readUpdateFeedUrl();
    return { ok: true, url };
  });

  ipcMain.handle('updates:getRuntimeState', async () => getUpdateRuntimeState());

  ipcMain.handle('updates:setConfig', async (_event, payload) => {
    try {
      const url = String(payload?.url || '').trim();
      if (!url) {
        throw new Error('Update feed URL cannot be empty');
      }

      const normalized = normalizeUpdateFeedUrl(url);
      if (!normalized) {
        throw new Error('Update feed URL must be a valid URL');
      }

      const configPath = getUserUpdateConfigPath();
      fs.writeFileSync(configPath, JSON.stringify({ url: normalized }, null, 2), 'utf8');
      if (!isPortableBuild) {
        autoUpdater.setFeedURL({ provider: 'generic', url: normalized });
        availableUpdateVersion = '';
        downloadedUpdateVersion = '';
        isUpdateReady = false;
        isCheckingForUpdate = false;
        isDownloadingUpdate = false;
        updateDownloadProgress = 0;
        updateStatusMessage = 'Update feed saved. Ready to check for new releases.';
        emitUpdateReadyState();
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  });

  ipcMain.handle('updates:downloadLatest', async () => {
    try {
      if (!isPortableBuild) {
        const runtime = await runAutoUpdaterCheck();
        const currentVersion = normalizeSemver(app.getVersion());
        const latestVersion = normalizeSemver(runtime.latestVersion || runtime.version || '');
        const noUpdate = !runtime.ready
          && !runtime.downloading
          && !runtime.checking
          && !runtime.installing
          && (!latestVersion || compareSemver(latestVersion, currentVersion) <= 0);
        return {
          ok: true,
          noUpdate,
          ready: Boolean(runtime.ready),
          checking: Boolean(runtime.checking),
          downloading: Boolean(runtime.downloading),
          installing: Boolean(runtime.installing),
          progress: Number(runtime.progress || 0),
          currentVersion,
          latestVersion,
          message: String(runtime.message || ''),
        };
      }

      const latestRelease = await resolveLatestInstallerRelease();
      const currentVersion = normalizeSemver(app.getVersion());
      const latestVersion = normalizeSemver(latestRelease.version || '');
      const compareResult = compareSemver(latestVersion, currentVersion);
      const updateState = readUpdateState();
      const lastDownloadedReleaseSignature = String(updateState.lastDownloadedReleaseSignature || '');
      const latestReleaseSignature = String(latestRelease.releaseSignature || '');
      const signatureChanged = Boolean(
        latestReleaseSignature
        && latestReleaseSignature !== lastDownloadedReleaseSignature
      );

      // Force a fresh package when feed metadata changed, even if version
      // strings are equal due manual feed mistakes.
      const shouldDownload =
        compareResult > 0
        || (compareResult === 0 && signatureChanged)
        || (!latestVersion && signatureChanged);

      if (!shouldDownload) {
        return {
          ok: true,
          noUpdate: true,
          portable: true,
          currentVersion,
          latestVersion: latestVersion || currentVersion,
          message: 'No New Updates',
        };
      }

      await shell.openExternal(latestRelease.installerUrl);
      writeUpdateState({
        lastDownloadedReleaseSignature: latestReleaseSignature,
        lastDownloadedVersion: latestVersion || latestRelease.version || '',
        lastDownloadedInstallerPath: latestRelease.installerPath || '',
        lastDownloadedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        noUpdate: false,
        portable: true,
        installerUrl: latestRelease.installerUrl,
        currentVersion,
        latestVersion,
        message: 'Portable build detected. Opening the latest NCore Setup installer so you can migrate to the self-updating build.',
      };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  });

  ipcMain.handle('updates:installNow', async () => {
    if (isPortableBuild) {
      return { ok: false, message: 'Auto-install update is unavailable on portable builds.' };
    }
    if (isInstallingUpdate) {
      return { ok: true, message: 'Update install is already in progress.' };
    }
    if (!isUpdateReady) {
      return { ok: false, message: 'No downloaded update is ready yet.' };
    }
    triggerUpdateInstall('renderer-install-now');
    return { ok: true, message: 'Restarting to apply update...' };
  });
}

function normalizeSemver(value) {
  const cleaned = String(value || '').trim().replace(/^v/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : '';
}

function compareSemver(a, b) {
  const pa = normalizeSemver(a).split('.').map((v) => Number(v));
  const pb = normalizeSemver(b).split('.').map((v) => Number(v));
  if (pa.length !== 3 || pb.length !== 3 || pa.some(Number.isNaN) || pb.some(Number.isNaN)) {
    return 0;
  }
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function parseLatestYml(latestText) {
  const versionMatch = latestText.match(/^version:\s*(.+)$/m);
  const pathMatch = latestText.match(/^path:\s*(.+)$/m);
  const fileUrlMatch = latestText.match(/^\s*-\s*url:\s*(.+)$/m);
  const topLevelShaMatch = latestText.match(/^sha512:\s*(.+)$/m);
  const fileShaMatch = latestText.match(/^\s*sha512:\s*(.+)$/m);
  const version = versionMatch ? String(versionMatch[1]).trim().replace(/^['"]|['"]$/g, '') : '';
  const installerPath = pathMatch
    ? String(pathMatch[1]).trim().replace(/^['"]|['"]$/g, '')
    : (fileUrlMatch ? String(fileUrlMatch[1]).trim().replace(/^['"]|['"]$/g, '') : '');
  const sha512 = topLevelShaMatch
    ? String(topLevelShaMatch[1]).trim().replace(/^['"]|['"]$/g, '')
    : (fileShaMatch ? String(fileShaMatch[1]).trim().replace(/^['"]|['"]$/g, '') : '');
  return { version, installerPath, sha512 };
}

async function resolveLatestInstallerRelease() {
  const configuredBaseUrl = readUpdateFeedUrl();
  const candidateBaseUrls = Array.from(new Set(
    [PRIMARY_UPDATE_FEED_URL, configuredBaseUrl].map((u) => normalizeUpdateFeedUrl(u)).filter(Boolean)
  ));

  let lastError = null;
  for (const baseUrl of candidateBaseUrls) {
    try {
      const cacheBust = Date.now();
      const latestYmlUrl = `${baseUrl.replace(/\/+$/, '')}/latest.yml?t=${cacheBust}`;
      const response = await fetch(latestYmlUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, max-age=0',
          Pragma: 'no-cache',
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch latest.yml (${response.status}) from ${baseUrl}`);
      }

      const latestText = await response.text();
      const latest = parseLatestYml(latestText);
      if (!latest.installerPath) {
        throw new Error(`latest.yml does not contain installer path (${baseUrl})`);
      }
      if (!latest.version) {
        throw new Error(`latest.yml does not contain release version (${baseUrl})`);
      }

      const releaseSignature = [
        normalizeSemver(latest.version) || String(latest.version || '').trim(),
        String(latest.installerPath || '').trim(),
        String(latest.sha512 || '').trim(),
      ].join('|');

      return {
        version: latest.version,
        installerPath: latest.installerPath,
        releaseSignature,
        installerUrl: `${baseUrl.replace(/\/+$/, '')}/${encodeURI(latest.installerPath)}?t=${cacheBust}`,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to resolve update feed from configured sources.');
}
