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

export const contextBridge = {
  exposeInMainWorld(name: string, api: unknown) {
    (window as unknown as Record<string, unknown>)[name] = api;
  },
};

export const app = {
  getPath: () => "/preview",
  getVersion: () => "preview",
  isPackaged: false,
  quit: () => undefined,
  exit: () => undefined,
};

export const dialog = {
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
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
