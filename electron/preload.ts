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
});
