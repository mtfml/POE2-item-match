import { uIOhook, UiohookKey } from "uiohook-napi";
import { HostClipboard } from "./HostClipboard";
import type { Logger } from "./Logger";

// Electron's globalShortcut (X11 XGrabKey under the hood) does not work on
// this machine's GNOME/Wayland+XWayland setup - confirmed by testing five
// unrelated key combos, all of which failed to register. uiohook-napi's raw
// keydown hook works reliably regardless (it's what simulates Ctrl+C below
// too), so the hotkey is detected manually here instead of via
// globalShortcut.
//
// Trigger: backtick, unmodified. PoE2 doesn't bind this by default. Edit
// TRIGGER_KEY/TRIGGER_MODS below if it collides with your own keybinds.
const TRIGGER_KEY: keyof typeof UiohookKey = "Backquote";
const TRIGGER_MODS = { ctrlKey: false, altKey: false, shiftKey: false };

// PoE's "Show advanced mod description" key must be held together with
// Ctrl+C, or hybrid/advanced mod text won't be included in the copy. Default
// PoE keybind is Alt. Edit here if you've rebound it in-game.
const SHOW_MODS_KEY: keyof typeof UiohookKey = "Alt";

export function registerPriceCheckHotkey(
  logger: Logger,
  onItemText: (text: string) => void,
) {
  const clipboard = new HostClipboard(logger);
  const triggerKeycode = UiohookKey[TRIGGER_KEY];

  uIOhook.on("keydown", (e) => {
    if (
      e.keycode !== triggerKeycode ||
      e.ctrlKey !== TRIGGER_MODS.ctrlKey ||
      e.altKey !== TRIGGER_MODS.altKey ||
      e.shiftKey !== TRIGGER_MODS.shiftKey
    ) {
      return;
    }

    if (clipboard.isPolling) return;

    clipboard
      .readItemText()
      .then((text) => onItemText(text))
      .catch(() => {
        logger.write("warn [hotkey] no item text copied within timeout");
      });

    pressKeysToCopyItemText();
  });

  logger.write(`info [hotkey] Watching for ${TRIGGER_KEY} via uiohook`);
}

function pressKeysToCopyItemText() {
  uIOhook.keyToggle(UiohookKey[SHOW_MODS_KEY], "down");
  uIOhook.keyToggle(UiohookKey.Ctrl, "down");
  uIOhook.keyTap(UiohookKey.C);

  // Timeout to enforce release of keys - the game sometimes drops release
  // inputs sent immediately after the tap.
  setTimeout(() => {
    uIOhook.keyToggle(UiohookKey.Ctrl, "up");
    uIOhook.keyToggle(UiohookKey[SHOW_MODS_KEY], "up");
  }, 10);
}
