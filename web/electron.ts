/*
 * Electron, as the app's main-process code and its preload see it, inside a
 * web page.
 *
 * The screens talk to the machine through ipcRenderer.invoke and the machine
 * answers through ipcMain.handle. Here both ends are in the same page: a
 * handler is kept in a map and invoking it is calling it. So preload.ts,
 * ipc.ts and ipc-trades.ts run in the builder's preview exactly as written.
 *
 * What has no meaning in a web page answers the way a careful machine would:
 * no file is ever written, a save dialog is always cancelled, a link opens in
 * a new tab, and printing puts the page it would have printed on the screen
 * (see print-slip.ts).
 */

type Handler = (event: unknown, ...args: unknown[]) => unknown;
type Listener = (event: unknown, payload: unknown) => void;

const handlers = new Map<string, Handler>();
const listeners = new Map<string, Set<Listener>>();

export const ipcMain = {
  handle(channel: string, handler: Handler) {
    handlers.set(channel, handler);
  },
  removeHandler(channel: string) {
    handlers.delete(channel);
  },
  on() {
    return ipcMain;
  },
};

export const ipcRenderer = {
  async invoke(channel: string, ...args: unknown[]) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`nothing answers ${channel} in the preview`);
    return handler({}, ...args);
  },
  on(channel: string, listener: Listener) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(listener);
    return ipcRenderer;
  },
  removeListener(channel: string, listener: Listener) {
    listeners.get(channel)?.delete(listener);
    return ipcRenderer;
  },
};

/*
 * What differs between the builder's preview and the phone app. The preview
 * keeps these defaults: no files, every dialog cancelled. The phone app
 * (web/phone/main.ts) answers them with its own disk, a download for a file
 * saved and the phone's file picker for a file opened.
 */
type SaveOptions = { defaultPath?: string; filters?: { name: string; extensions: string[] }[] };
type OpenOptions = { filters?: { name: string; extensions: string[] }[] };
export const host = {
  getPath: (_name: string) => "/preview",
  version: "preview",
  showSaveDialog: async (_options: SaveOptions): Promise<{ canceled: boolean; filePath?: string }> => ({ canceled: true, filePath: undefined }),
  showOpenDialog: async (_options: OpenOptions): Promise<{ canceled: boolean; filePaths: string[] }> => ({ canceled: true, filePaths: [] }),
  relaunch: () => undefined as void,
};

export function configureHost(next: Partial<typeof host>): void {
  Object.assign(host, next);
}

/* The main side telling the window something, as webContents.send does in Electron. */
export function sendToWindow(channel: string, payload?: unknown): void {
  for (const listener of listeners.get(channel) ?? []) listener({}, payload);
}

export const contextBridge = {
  exposeInMainWorld(name: string, api: unknown) {
    (window as unknown as Record<string, unknown>)[name] = api;
  },
};

export const app = {
  getPath: (name: string) => host.getPath(name),
  getVersion: () => host.version,
  isPackaged: false,
  quit: () => undefined,
  exit: () => undefined,
  relaunch: () => host.relaunch(),
};

/* Electron takes the window first; the stand-in takes it and passes the options on. */
export const dialog = {
  showSaveDialog: async (_window: unknown, options: SaveOptions = {}) => host.showSaveDialog(options),
  showOpenDialog: async (_window: unknown, options: OpenOptions = {}) => host.showOpenDialog(options),
  showMessageBox: async () => ({ response: 0 }),
  showErrorBox: () => undefined,
};

export const shell = {
  openExternal: async (url: string) => {
    window.open(url, "_blank", "noopener");
  },
  openPath: async () => "",
  showItemInFolder: () => undefined,
};

/*
 * The one window the main process ever opens itself: the hidden page a
 * receipt or a document is printed from. Printing it shows it instead.
 */
export class BrowserWindow {
  private html = "";
  private destroyed = false;

  webContents = {
    executeJavaScript: async () => 0,
    getPrintersAsync: async () => [] as { name: string; displayName: string }[],
    print: (options: { pageSize?: unknown }, done: (success: boolean, reason: string) => void) => {
      window.dispatchEvent(new CustomEvent("ouaqt:printed", { detail: { html: this.html, sheet: options.pageSize === "A4" } }));
      done(true, "");
    },
    printToPDF: async () => new Uint8Array(),
  };

  constructor(_options?: unknown) {}

  async loadURL(url: string) {
    const prefix = "data:text/html;charset=utf-8,";
    this.html = url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : "";
  }

  isDestroyed() {
    return this.destroyed;
  }

  close() {
    this.destroyed = true;
  }

  static getAllWindows() {
    return [];
  }
}

export default { ipcMain, ipcRenderer, contextBridge, app, dialog, shell, BrowserWindow };
