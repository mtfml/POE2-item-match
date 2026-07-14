import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("host", {
  onParsedItem: (cb: (item: unknown) => void) => {
    ipcRenderer.on("parsed-item", (_event, item: unknown) => cb(item));
  },
  onParseError: (cb: (error: string) => void) => {
    ipcRenderer.on("parse-error", (_event, error: string) => cb(error));
  },
  onPriceCheckResult: (cb: (result: unknown) => void) => {
    ipcRenderer.on("price-check-result", (_event, result: unknown) => cb(result));
  },
  onPriceCheckError: (cb: (error: string) => void) => {
    ipcRenderer.on("price-check-error", (_event, error: string) => cb(error));
  },
  reSearch: (filters: unknown, stats: unknown) =>
    ipcRenderer.invoke("re-search", filters, stats),
});
