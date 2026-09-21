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
});
