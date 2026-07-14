// Reimplementation of EE2's renderer/src/assets/data/index.ts data-loading
// layer for a plain Node/Electron context: fs.readFileSync instead of
// fetch(), a plain in-memory Map instead of the binary fnv1a search-index
// files (the dataset is a few thousand entries - a Map is simpler and fast
// enough for a single-user desktop app).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BaseType,
  Stat,
  StatMatcher,
  TranslationDict,
} from "./interfaces";
import { ItemCategory, GEM } from "../parser/meta";
import { ItemRarity } from "../parser/ParsedItem";

export * from "./interfaces";
export { StatBetter } from "./interfaces";

// The app is always launched with the project root as cwd (`electron .` /
// `npm run dev`), so this is robust regardless of how deep this module ends
// up bundled/nested (unlike a __dirname-relative path).
const DATA_DIR = path.join(process.cwd(), "data");

let itemsByRef = new Map<string, BaseType[]>();
let itemsByTranslated = new Map<string, BaseType[]>();
let allItems: BaseType[] = [];
let tradeTagToRef = new Map<string, string>();

let statsByRef = new Map<string, Stat>();
let statsByMatchStr = new Map<string, { matcher: StatMatcher; stat: Stat }>();
let allStats: Stat[] = [];

export let CLIENT_STRINGS: TranslationDict;
export let CLIENT_STRINGS_REF: TranslationDict;

export const TRADE_TAG_TO_REF = new Map<string, string>();

export function ITEM_BY_REF(
  ns: BaseType["namespace"],
  name: string,
): BaseType[] | undefined {
  return itemsByRef.get(`${ns}::${name}`);
}

export function ITEM_BY_TRANSLATED(
  ns: BaseType["namespace"],
  name: string,
): BaseType[] | undefined {
  return itemsByTranslated.get(`${ns}::${name}`);
}

export function* ITEMS_ITERATOR(
  includes: string,
  andIncludes: string[] = [],
): Generator<BaseType> {
  for (const item of allItems) {
    const line = JSON.stringify(item);
    if (line.includes(includes) && andIncludes.every((s) => line.includes(s))) {
      yield item;
    }
  }
}

export function* GEM_NS_NAMES(): Generator<string> {
  for (const item of allItems) if (item.namespace === "GEM") yield item.name;
}
export function* UNIQUE_NS_NAMES(): Generator<string> {
  for (const item of allItems) if (item.namespace === "UNIQUE") yield item.name;
}
export function* ITEM_NS_NAMES(): Generator<string> {
  for (const item of allItems) if (item.namespace === "ITEM") yield item.name;
}

export function STAT_BY_REF(ref: string): Stat | undefined {
  return statsByRef.get(ref);
}

export function STAT_BY_MATCH_STR(
  matchStr: string,
): { matcher: StatMatcher; stat: Stat } | undefined {
  return statsByMatchStr.get(matchStr);
}

export function* STATS_ITERATOR(
  includes: string,
  andIncludes: string[] = [],
): Generator<Stat> {
  for (const s of allStats) {
    const line = JSON.stringify(s);
    if (line.includes(includes) && andIncludes.every((str) => line.includes(str))) {
      yield s;
    }
  }
}

// Live pathofexile.com/api/trade2/data/{items,stats} validation - wired up
// once the trade module lands (task 5). Until then, these are permissive
// no-ops so parsing still works without live-data enrichment.
export let TRADE_ITEM_BY_REF: (
  itemQuery: {
    baseType?: string;
    name?: string;
    rarity?: ItemRarity;
    category?: ItemCategory;
  },
  forceCraftable?: boolean,
) => BaseType[] | undefined = () => undefined;

export let TRADE_STAT_BY_STAT_ID: (tradeId: string) => boolean = () => false;
export let TRADE_STAT_BY_MATCH_STR: (
  name: string,
) => { [type: string]: string[] } | undefined = () => undefined;

const DELAYED_STAT_VALIDATION = new Set<string>();
export function stat(text: string) {
  DELAYED_STAT_VALIDATION.add(text);
  return text;
}

function loadNdjson<T>(filePath: string): T[] {
  const contents = fs.readFileSync(filePath, "utf-8");
  const out: T[] = [];
  for (const line of contents.split("\n")) {
    if (line.trim().length === 0) continue;
    out.push(JSON.parse(line) as T);
  }
  return out;
}

function loadItems(lang: string) {
  allItems = loadNdjson<BaseType>(path.join(DATA_DIR, lang, "items.ndjson"));

  itemsByRef = new Map();
  itemsByTranslated = new Map();
  tradeTagToRef = new Map();

  for (const item of allItems) {
    const refKey = `${item.namespace}::${item.refName}`;
    const nameKey = `${item.namespace}::${item.name}`;
    if (!itemsByRef.has(refKey)) itemsByRef.set(refKey, []);
    itemsByRef.get(refKey)!.push(item);
    if (!itemsByTranslated.has(nameKey)) itemsByTranslated.set(nameKey, []);
    itemsByTranslated.get(nameKey)!.push(item);
    if (item.tradeTag) tradeTagToRef.set(item.tradeTag, item.refName);
  }

  TRADE_TAG_TO_REF.clear();
  for (const [k, v] of tradeTagToRef) TRADE_TAG_TO_REF.set(k, v);
}

function loadStats(lang: string) {
  allStats = loadNdjson<Stat>(path.join(DATA_DIR, lang, "stats.ndjson"));

  statsByRef = new Map();
  statsByMatchStr = new Map();

  for (const s of allStats) {
    statsByRef.set(s.ref, s);
    for (const matcher of s.matchers) {
      statsByMatchStr.set(matcher.string, { matcher, stat: s });
      if (matcher.advanced) {
        statsByMatchStr.set(matcher.advanced, { matcher, stat: s });
      }
    }
  }
}

async function loadClientStrings(lang: string): Promise<TranslationDict> {
  const filePath = path.join(DATA_DIR, lang, "client_strings.mjs");
  const mod = (await import(pathToFileURL(filePath).href)) as {
    default: TranslationDict;
  };
  return mod.default;
}

export async function init(lang: string) {
  CLIENT_STRINGS_REF = await loadClientStrings("en");
  CLIENT_STRINGS = await loadClientStrings(lang);
  loadItems(lang);
  loadStats(lang);

  let failed = false;
  const missing: string[] = [];
  for (const text of DELAYED_STAT_VALIDATION) {
    if (STAT_BY_REF(text) == null) {
      missing.push(text);
      failed = true;
    }
  }
  if (failed) {
    console.log(
      "Cannot find stat" + (missing.length > 1 ? "s" : "") + missing.join("\n"),
    );
  }
  DELAYED_STAT_VALIDATION.clear();
}

// referenced to keep GEM/ItemCategory imports used once TRADE_ITEM_BY_REF is
// implemented for real in task 5
void GEM;
void ItemCategory;
