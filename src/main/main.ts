import { app, BrowserWindow, ipcMain } from "electron";
import { uIOhook } from "uiohook-napi";
import path from "node:path";
import { Logger } from "./Logger";
import { registerPriceCheckHotkey } from "./hotkey";
import { init as initData } from "../shared/data";
import { parseClipboard } from "../shared/parser";
import type { ParsedItem } from "../shared/parser";
import type { ItemFilters, StatFilter } from "../shared/filters/interfaces";
import { LANGUAGE } from "../shared/language";
import { runPriceCheck, searchWithFilters } from "./trade";

const logger = new Logger();

if (!app.requestSingleInstanceLock()) {
  app.exit();
}

let mainWindow: BrowserWindow | undefined;
let lastParsedItem: ParsedItem | undefined;

app.on("ready", async () => {
  await initData(LANGUAGE);
  logger.write("info [main] static item/stat data loaded");

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"));

  uIOhook.start();

  registerPriceCheckHotkey(logger, async (itemText) => {
    const result = parseClipboard(itemText);
    if (result.isErr()) {
      logger.write(`warn [main] failed to parse item: ${result.error}`);
      mainWindow?.webContents.send("parse-error", result.error);
      return;
    }
    const item = result.value;
    lastParsedItem = item;
    logger.write(`info [main] parsed item: ${item.info.name ?? item.info.refName}`);
    mainWindow?.webContents.send("parsed-item", item);

    try {
      const priceCheck = await runPriceCheck(item, logger);
      mainWindow?.webContents.send("price-check-result", priceCheck);
    } catch (e) {
      logger.write(`error [main] trade search failed: ${(e as Error).message}`);
      mainWindow?.webContents.send("price-check-error", (e as Error).message);
    }
  });

  ipcMain.handle(
    "re-search",
    async (_event, filters: ItemFilters, stats: StatFilter[]) => {
      if (!lastParsedItem) throw new Error("No item to search for");
      return searchWithFilters(lastParsedItem, filters, stats, logger);
    },
  );
});
