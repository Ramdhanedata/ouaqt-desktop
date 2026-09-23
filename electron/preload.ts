import { contextBridge, ipcRenderer } from "electron";

/*
 * The only bridge between the screens and the machine.
 *
 * Deliberately a list, not a pipe. Everything the renderer can do is written
 * here by name, so what the interface is able to reach is one file long and
 * can be read in a few minutes. There is no call that takes a channel name
 * or a file path from the screen.
 */
const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("ouaqt", {
  readConfiguration: invoke("configuration:read"),
  databaseState: invoke("database:state"),

  products: invoke("products:list"),
  productDetail: invoke("products:detail"),
  addProduct: invoke("products:add"),
  updateProduct: invoke("products:update"),
  archiveProduct: invoke("products:archive"),
  receiveStock: invoke("stock:receive"),
  adjustStock: invoke("stock:adjust"),
  stockOverview: invoke("stock:overview"),
  stockFlags: invoke("stock:flags"),

  recordSale: invoke("sales:record"),
  recentSales: invoke("sales:recent"),
  voidSale: invoke("sales:void"),
  saleDetail: invoke("sales:detail"),
  salesBetween: invoke("sales:between"),

  customers: invoke("customers:list"),
  customerDetail: invoke("customers:detail"),
  addCustomer: invoke("customers:add"),
  updateCustomer: invoke("customers:update"),
  recordPayment: invoke("customers:pay"),

  cashCurrent: invoke("cash:current"),
  cashHistory: invoke("cash:history"),
  cashOpen: invoke("cash:open"),
  cashClose: invoke("cash:close"),

  reportSummary: invoke("reports:summary"),
  reportTop: invoke("reports:top"),
  reportExport: invoke("reports:export"),
  trialSummary: invoke("reports:trial"),
  recentAudit: invoke("audit:recent"),

  printSettings: invoke("print:settings"),
  savePrintSettings: invoke("print:save"),
  printers: invoke("print:printers"),
  printReceipt: invoke("print:receipt"),
  printTest: invoke("print:test"),

  backupInfo: invoke("backup:info"),
  backupSave: invoke("backup:save"),
  backupPick: invoke("backup:pick"),
  backupRestore: invoke("backup:restore"),

  appInfo: invoke("app:info"),
  licenceState: invoke("licence:state"),
  activate: invoke("licence:activate"),
  /* The result of an activation that arrived through the ouaqt:// link. */
  onActivated: (handler: (result: unknown) => void) => {
    const listener = (_event: unknown, result: unknown) => handler(result);
    ipcRenderer.on("licence:activated", listener);
    return () => ipcRenderer.removeListener("licence:activated", listener);
  },
  openWhatsapp: invoke("open:whatsapp"),
  /* A new version has downloaded and will install when the app is closed. */
  onUpdateReady: (handler: (info: { version: string }) => void) => {
    const listener = (_event: unknown, info: { version: string }) => handler(info);
    ipcRenderer.on("update:ready", listener);
    return () => ipcRenderer.removeListener("update:ready", listener);
  },
});
