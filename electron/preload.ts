import { contextBridge, ipcRenderer } from "electron";

/*
 * The only bridge between the screens and the machine.
 *
 * Deliberately a short list. Everything the renderer can do is written here,
 * so what the interface is able to reach is one file long and can be read in
 * a minute.
 */
contextBridge.exposeInMainWorld("ouaqt", {
  readConfiguration: () => ipcRenderer.invoke("configuration:read"),
  databaseState: () => ipcRenderer.invoke("database:state"),

  products: (term?: string) => ipcRenderer.invoke("products:list", term),
  recordSale: (sale: unknown) => ipcRenderer.invoke("sales:record", sale),
  recentSales: (limit?: number) => ipcRenderer.invoke("sales:recent", limit),
  voidSale: (saleId: string, reason: string, staffId: string | null) =>
    ipcRenderer.invoke("sales:void", saleId, reason, staffId),
  cashExpected: (since: string) => ipcRenderer.invoke("cash:expected", since),

  appInfo: () => ipcRenderer.invoke("app:info"),
  licenceState: () => ipcRenderer.invoke("licence:state"),
  activate: (serial: string) => ipcRenderer.invoke("licence:activate", serial),
  /* The result of an activation that arrived through the ouaqt:// link. */
  onActivated: (handler: (result: unknown) => void) => {
    const listener = (_event: unknown, result: unknown) => handler(result);
    ipcRenderer.on("licence:activated", listener);
    return () => ipcRenderer.removeListener("licence:activated", listener);
  },
  openWhatsapp: (number: string) => ipcRenderer.invoke("open:whatsapp", number),
  /* A new version has downloaded and will install when the app is closed. */
  onUpdateReady: (handler: (info: { version: string }) => void) => {
    const listener = (_event: unknown, info: { version: string }) => handler(info);
    ipcRenderer.on("update:ready", listener);
    return () => ipcRenderer.removeListener("update:ready", listener);
  },
});
