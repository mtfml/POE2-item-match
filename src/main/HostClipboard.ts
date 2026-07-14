// Ported near-verbatim from Exiled-Exchange-2's main/src/shortcuts/HostClipboard.ts
import { clipboard, Clipboard } from "electron";
import type { Logger } from "./Logger";

const POLL_DELAY = 48;
const POLL_LIMIT = 500;

// PoE must read clipboard within this timeframe,
// after that we restore clipboard.
// If game lagged for some reason, it will read
// wrong content (= restored clipboard, potentially containing password).
const RESTORE_AFTER = 120;

export class HostClipboard {
  private pollPromise?: Promise<string>;
  private elapsed = 0;
  private shouldRestore = true;
  private initialDelay = POLL_DELAY;

  private isRestored = true;

  get isPolling() {
    return this.pollPromise != null;
  }

  constructor(private logger: Logger) {}

  async readItemText(): Promise<string> {
    this.elapsed = 0;
    if (this.pollPromise) {
      return await this.pollPromise;
    }

    let textBefore = clipboard.readText();
    if (isPoeItem(textBefore)) {
      textBefore = "";
      if (process.platform !== "linux") {
        clipboard.writeText("");
      } else {
        // workaround KDE's "Prevent empty clipboard" feature
        clipboard.writeText(`__PC_FORCE_EMPTY_${Date.now()}`);
      }
    } else if (process.platform === "linux") {
      // workaround bug in Proton 10+ clipboard handling
      clipboard.writeText(`__PC_FORCE_EMPTY_${Date.now()}`);
    }

    this.pollPromise = new Promise((resolve, reject) => {
      const poll = () => {
        const textAfter = clipboard.readText();

        if (isPoeItem(textAfter)) {
          if (this.shouldRestore) {
            clipboard.writeText(textBefore);
          }
          this.pollPromise = undefined;
          resolve(textAfter);
        } else {
          this.elapsed += POLL_DELAY;
          if (this.elapsed < POLL_LIMIT) {
            setTimeout(poll, POLL_DELAY);
          } else {
            if (this.shouldRestore) {
              clipboard.writeText(textBefore);
            }
            this.pollPromise = undefined;

            if (!isPoeItem(textAfter)) {
              this.logger.write(
                `warn [ClipboardPoller] No item text found. clipboard now = ${JSON.stringify(textAfter.slice(0, 80))}`,
              );
            }
            reject(new Error("Reading clipboard timed out"));
          }
        }
      };
      setTimeout(poll, this.initialDelay);
    });

    return await this.pollPromise;
  }

  updateDelay(delay: number) {
    this.initialDelay = delay;
  }
}

function isPoeItem(text: string) {
  return LANGUAGE_DETECTOR.find(
    ({ firstLine, uncutSkillGemLine }) =>
      text.startsWith(firstLine) || text.startsWith(uncutSkillGemLine),
  );
}

const LANGUAGE_DETECTOR = [
  { lang: "en", firstLine: "Item Class: ", uncutSkillGemLine: "Rarity: " },
  { lang: "ru", firstLine: "Класс предмета: ", uncutSkillGemLine: "Редкость: " },
  { lang: "fr", firstLine: "Classe d'objet: ", uncutSkillGemLine: "Rareté: " },
  { lang: "de", firstLine: "Gegenstandsklasse: ", uncutSkillGemLine: "Seltenheit: " },
  { lang: "pt", firstLine: "Classe do Item: ", uncutSkillGemLine: "Raridade: " },
  { lang: "es", firstLine: "Clase de objeto: ", uncutSkillGemLine: "Rareza: " },
  { lang: "th", firstLine: "ชนิดไอเทม: ", uncutSkillGemLine: "Rarity: " },
  { lang: "ko", firstLine: "아이템 종류: ", uncutSkillGemLine: "아이템 희귀도: " },
  { lang: "cmn-Hant", firstLine: "物品種類: ", uncutSkillGemLine: "稀有度: " },
  { lang: "cmn-Hans", firstLine: "物品类别: ", uncutSkillGemLine: "Rarity: " },
  { lang: "ja", firstLine: "アイテムクラス: ", uncutSkillGemLine: "レアリティ: " },
];
