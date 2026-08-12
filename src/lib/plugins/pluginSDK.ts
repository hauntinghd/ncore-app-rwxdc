/**
 * NCore Plugin SDK
 *
 * Provides a sandboxed iframe-based plugin runtime.
 * Plugins communicate with the host via postMessage API.
 *
 * Plugin Manifest (plugin.json):
 *   {
 *     "id": "my-plugin",
 *     "name": "My Plugin",
 *     "version": "1.0.0",
 *     "author": "username",
 *     "description": "Does cool things",
 *     "permissions": ["read_messages", "send_messages", "read_members"],
 *     "entry": "index.html",
 *     "icon": "icon.png"
 *   }
 *
 * Permissions:
 *   read_messages  - Read messages in channels the plugin is installed in
 *   send_messages  - Send messages as the plugin
 *   read_members   - Read community member list
 *   register_commands - Register slash commands
 *   manage_ui      - Inject UI panels into the sidebar
 */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  permissions: PluginPermission[];
  entry: string;
  icon?: string;
}

export type PluginPermission =
  | 'read_messages'
  | 'send_messages'
  | 'read_members'
  | 'register_commands'
  | 'manage_ui';

export interface PluginMessage {
  type: string;
  pluginId: string;
  payload: any;
}

// Host → Plugin messages
export interface HostToPluginMessage {
  type: 'init' | 'message_received' | 'command_invoked' | 'theme_changed';
  data: any;
}

// Plugin → Host messages
export interface PluginToHostMessage {
  type: 'send_message' | 'register_command' | 'show_toast' | 'request_members' | 'ready';
  data: any;
}

// ---------------------------------------------------------------------------
// Plugin Sandbox
// ---------------------------------------------------------------------------

export class PluginSandbox {
  private iframe: HTMLIFrameElement | null = null;
  private manifest: PluginManifest;
  private container: HTMLElement;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private eventListeners = new Map<string, Array<(data: any) => void>>();

  constructor(manifest: PluginManifest, container: HTMLElement) {
    this.manifest = manifest;
    this.container = container;
  }

  start(entryUrl: string) {
    this.iframe = document.createElement('iframe');
    this.iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
    this.iframe.setAttribute('referrerpolicy', 'no-referrer');
    this.iframe.style.width = '100%';
    this.iframe.style.height = '100%';
    this.iframe.style.border = 'none';
    this.iframe.style.backgroundColor = 'transparent';
    this.iframe.src = entryUrl;

    this.messageHandler = (event: MessageEvent) => {
      if (event.source !== this.iframe?.contentWindow) return;
      this.handlePluginMessage(event.data);
    };
    window.addEventListener('message', this.messageHandler);
    this.container.appendChild(this.iframe);
  }

  stop() {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.eventListeners.clear();
  }

  sendToPlugin(message: HostToPluginMessage) {
    if (!this.iframe?.contentWindow) return;
    this.iframe.contentWindow.postMessage(message, '*');
  }

  on(event: string, handler: (data: any) => void) {
    const handlers = this.eventListeners.get(event) || [];
    handlers.push(handler);
    this.eventListeners.set(event, handlers);
  }

  private hasPermission(permission: PluginPermission): boolean {
    return this.manifest.permissions.includes(permission);
  }

  private handlePluginMessage(message: PluginToHostMessage) {
    if (!message?.type) return;

    switch (message.type) {
      case 'ready':
        this.sendToPlugin({
          type: 'init',
          data: {
            pluginId: this.manifest.id,
            permissions: this.manifest.permissions,
          },
        });
        break;

      case 'send_message':
        if (!this.hasPermission('send_messages')) {
          console.warn(`Plugin ${this.manifest.id} tried to send_message without permission`);
          return;
        }
        this.emit('send_message', message.data);
        break;

      case 'register_command':
        if (!this.hasPermission('register_commands')) {
          console.warn(`Plugin ${this.manifest.id} tried to register_command without permission`);
          return;
        }
        this.emit('register_command', message.data);
        break;

      case 'request_members':
        if (!this.hasPermission('read_members')) {
          console.warn(`Plugin ${this.manifest.id} tried to request_members without permission`);
          return;
        }
        this.emit('request_members', message.data);
        break;

      case 'show_toast':
        this.emit('show_toast', message.data);
        break;

      default:
        console.warn(`Unknown plugin message type: ${message.type}`);
    }
  }

  private emit(event: string, data: any) {
    const handlers = this.eventListeners.get(event) || [];
    handlers.forEach((handler) => handler(data));
  }
}

// ---------------------------------------------------------------------------
// Plugin Manager
// ---------------------------------------------------------------------------

export class PluginManager {
  private plugins = new Map<string, { manifest: PluginManifest; sandbox: PluginSandbox | null }>();

  register(manifest: PluginManifest) {
    this.plugins.set(manifest.id, { manifest, sandbox: null });
  }

  unregister(pluginId: string) {
    const entry = this.plugins.get(pluginId);
    if (entry?.sandbox) entry.sandbox.stop();
    this.plugins.delete(pluginId);
  }

  activate(pluginId: string, container: HTMLElement, entryUrl: string) {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new Error(`Plugin ${pluginId} not registered`);
    if (entry.sandbox) entry.sandbox.stop();

    const sandbox = new PluginSandbox(entry.manifest, container);
    sandbox.start(entryUrl);
    entry.sandbox = sandbox;
    return sandbox;
  }

  deactivate(pluginId: string) {
    const entry = this.plugins.get(pluginId);
    if (entry?.sandbox) {
      entry.sandbox.stop();
      entry.sandbox = null;
    }
  }

  getManifest(pluginId: string): PluginManifest | null {
    return this.plugins.get(pluginId)?.manifest || null;
  }

  listPlugins(): PluginManifest[] {
    return Array.from(this.plugins.values()).map((e) => e.manifest);
  }
}

export const pluginManager = new PluginManager();
