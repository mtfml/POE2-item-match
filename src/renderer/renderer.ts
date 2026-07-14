import type { ParsedItem } from "../shared/parser";
import { FilterTag } from "../shared/filters/interfaces";
import type { ItemFilters, StatFilter } from "../shared/filters/interfaces";
import type { PricingResult } from "../shared/trade/pathofexile-trade";

export {};

declare global {
  interface Window {
    host: {
      onParsedItem: (cb: (item: ParsedItem) => void) => void;
      onParseError: (cb: (error: string) => void) => void;
      onPriceCheckResult: (
        cb: (result: { filters: ItemFilters; stats: StatFilter[]; results: PricingResult[] }) => void,
      ) => void;
      onPriceCheckError: (cb: (error: string) => void) => void;
      reSearch: (
        filters: ItemFilters,
        stats: StatFilter[],
      ) => Promise<PricingResult[]>;
    };
  }
}

const app = document.getElementById("app")!;

let currentItem: ParsedItem | undefined;
let currentFilters: ItemFilters | undefined;
let currentStats: StatFilter[] = [];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    node.append(child);
  }
  return node;
}

function render() {
  app.replaceChildren();
  if (!currentItem) {
    app.append("Waiting for ` over an item in PoE2...");
    return;
  }

  app.append(renderItemHeader(currentItem));

  // EE2 marks a number of filters `hidden` (redundant aggregates, crafting
  // bookkeeping, map-irrelevant filters, etc, each with its own reason -
  // see the `filters.hide_*` assignments throughout create-stat-filters.ts
  // and pseudo/*.ts) meant to stay out of the default view. This app has no
  // "show more" toggle to reveal them, so they're left out entirely rather
  // than always shown.
  const visibleStats = currentStats.filter((s) => !s.hidden);

  const filterSection = el("section", {});
  filterSection.append(renderFiltersTable(visibleStats, currentFilters));
  const searchRow = el("div", { id: "search-btn-row" });
  const searchBtn = el("button", {}, ["Search"]);
  searchBtn.addEventListener("click", () => void runSearch(searchBtn));
  searchRow.append(searchBtn);
  filterSection.append(searchRow);
  app.append(filterSection);

  const resultsSection = el("section", {});
  resultsSection.append(el("h1", {}, ["Results"]));
  resultsSection.id = "results-section";
  resultsSection.append(el("div", { className: "muted" }, ["Run a search to see listings."]));
  app.append(resultsSection);
}

function renderItemHeader(item: ParsedItem) {
  const header = el("div", { className: "item-header" });
  header.append(
    el("div", { className: `name rarity-${item.rarity ?? "Normal"}` }, [
      item.info.name ?? item.info.refName,
    ]),
  );
  const meta: string[] = [];
  if (item.category) meta.push(item.category);
  if (item.itemLevel) meta.push(`Item Level ${item.itemLevel}`);
  header.append(el("div", { className: "muted" }, [meta.join(" · ")]));
  return header;
}

// StatFilter.text is the untranslated matcher template ("#% increased
// Evasion Rating"), not the item's actual display text - fill the
// placeholder(s) with the rolled value for a readable read-only summary.
//
// Two-placeholder stats ("Adds # to # Lightning Damage") aren't a single
// value with a search tolerance - min and max are both genuinely on the
// item (e.g. "Adds 1 to 231 Lightning Damage"). stat.roll here is our own
// search-bracket range (built around the average), not those two numbers,
// so for a 2-# stat this sums the original per-item roll across every
// contributing source instead (a "local" and a "global" damage-adding mod
// can both feed the same displayed stat, so the true range is the sum of
// both, not just the first source's own range).
function fillStatText(stat: StatFilter): string {
  const placeholders = stat.text.match(/#/g)?.length ?? 0;
  if (placeholders >= 2 && stat.sources.length > 0) {
    let min = 0;
    let max = 0;
    for (const source of stat.sources) {
      if (!source.stat.roll) continue;
      min += source.stat.roll.min;
      max += source.stat.roll.max;
    }
    const values = [min, max];
    let i = 0;
    return stat.text.replace(/#/g, () => String(values[i++]));
  }
  if (!stat.roll) return stat.text;
  return stat.text.replace(/#/g, String(stat.roll.value));
}

type ModGroup = "base" | "implicit" | "socket" | "prefix" | "suffix" | "other";

const MOD_GROUP_ORDER: Record<ModGroup, number> = {
  base: 0,
  implicit: 1,
  socket: 2,
  prefix: 3,
  suffix: 4,
  other: 5,
};
const MOD_GROUP_LABELS: Record<ModGroup, string> = {
  base: "Base",
  implicit: "Implicit",
  socket: "Sockets",
  prefix: "Prefix",
  suffix: "Suffix",
  other: "Other",
};

// Base (item property totals) < Implicit < Sockets (runes) < Prefix <
// Suffix < everything else (corrupted etc.), stable within each group.
function filterGroup(stat: StatFilter): ModGroup {
  if (stat.tag === FilterTag.Property) return "base";
  if (stat.tag === FilterTag.Implicit) return "implicit";
  const modType = stat.sources[0]?.modifier.info.type;
  if (modType === "rune" || modType === "added-rune") return "socket";
  const gen = stat.sources[0]?.modifier.info.generation;
  return gen === "prefix" || gen === "suffix" ? gen : "other";
}

function renderStatRow(stat: StatFilter) {
  const row = el("tr", {});

  const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
  checkbox.checked = !stat.disabled;
  checkbox.addEventListener("change", () => {
    stat.disabled = !checkbox.checked;
  });
  row.append(el("td", {}, [checkbox]));

  row.append(el("td", {}, [fillStatText(stat)]));

  const rangeCell = el("td", {});
  if (stat.roll) {
    const minInput = el("input", {
      type: "number",
      value: String(stat.roll.min ?? ""),
    }) as HTMLInputElement;
    minInput.addEventListener("input", () => {
      stat.roll!.min = minInput.value === "" ? "" : Number(minInput.value);
    });
    const maxInput = el("input", {
      type: "number",
      value: String(stat.roll.max ?? ""),
    }) as HTMLInputElement;
    maxInput.addEventListener("input", () => {
      stat.roll!.max = maxInput.value === "" ? "" : Number(maxInput.value);
    });
    rangeCell.append(minInput, " – ", maxInput);
  }
  row.append(rangeCell);

  return row;
}

function renderGroupLabel(label: string) {
  return el("tr", {}, [
    el("td", { colSpan: 3, className: "muted mod-group-label" }, [label]),
  ]);
}

// Socket count ("2 Runes Socketed") isn't a mod roll - it's its own field
// on ItemFilters, not part of the stats[] array - so it needs its own row
// wired to a different piece of state.
function renderSocketCountRow(filters: ItemFilters) {
  const socketFilter = filters.augmentSockets!;
  const row = el("tr", {});

  const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
  checkbox.checked = !socketFilter.disabled;
  checkbox.addEventListener("change", () => {
    socketFilter.disabled = !checkbox.checked;
  });
  row.append(el("td", {}, [checkbox]));
  row.append(el("td", {}, [`${socketFilter.value} Runes Socketed`]));

  const valueInput = el("input", {
    type: "number",
    value: String(socketFilter.value),
  }) as HTMLInputElement;
  valueInput.addEventListener("input", () => {
    socketFilter.value = Number(valueInput.value);
  });
  row.append(el("td", {}, [valueInput]));

  return row;
}

function renderFiltersTable(stats: StatFilter[], filters: ItemFilters | undefined) {
  const sorted = [...stats].sort(
    (a, b) => MOD_GROUP_ORDER[filterGroup(a)] - MOD_GROUP_ORDER[filterGroup(b)],
  );

  const table = el("table", { className: "filters-table" });
  let lastGeneration: ModGroup | undefined;

  for (const stat of sorted) {
    const generation = filterGroup(stat);
    if (generation !== lastGeneration) {
      table.append(renderGroupLabel(MOD_GROUP_LABELS[generation]));
    }
    lastGeneration = generation;
    table.append(renderStatRow(stat));
  }

  if (filters?.augmentSockets) {
    if (lastGeneration !== "other") table.append(renderGroupLabel(MOD_GROUP_LABELS.other));
    table.append(renderSocketCountRow(filters));
  }

  return table;
}

async function runSearch(triggerBtn: HTMLButtonElement) {
  if (!currentFilters) return;
  triggerBtn.disabled = true;
  triggerBtn.textContent = "Searching...";
  const resultsSection = document.getElementById("results-section")!;
  resultsSection.replaceChildren(el("div", { className: "muted" }, ["Searching..."]));

  try {
    const results = await window.host.reSearch(currentFilters, currentStats);
    resultsSection.replaceChildren(el("h1", {}, ["Results"]), renderResultsTable(results));
  } catch (e) {
    resultsSection.replaceChildren(
      el("div", { className: "muted" }, [`Search failed: ${(e as Error).message}`]),
    );
  } finally {
    triggerBtn.disabled = false;
    triggerBtn.textContent = "Search";
  }
}

// Trade API tier strings look like "P6", "S3", or combined "P3 + P1" for
// merged prefix/suffix rolls - first letter is what determines the group.
function tierGroupRank(tier: string | undefined): number {
  if (tier?.startsWith("P")) return 0;
  if (tier?.startsWith("S")) return 1;
  return 2;
}

function renderModGroup(label: string, mods: Array<{ text: string }>) {
  const group = el("div", { className: "mod-group" });
  group.append(el("div", { className: "muted mod-group-label" }, [label]));
  const list = el("ul", { className: "mods" });
  for (const mod of mods) list.append(el("li", {}, [mod.text]));
  group.append(list);
  return group;
}

// Same Implicit / Prefix / Suffix grouping as the search section, applied
// to a sold listing's actual mods.
function renderModsList(displayItem: PricingResult["displayItem"]) {
  const container = el("div", {});
  const implicitMods = displayItem?.implicitMods ?? [];
  const explicitMods = [...(displayItem?.explicitMods ?? [])].sort(
    (a, b) => tierGroupRank(a.tier) - tierGroupRank(b.tier),
  );
  const prefixes = explicitMods.filter((m) => tierGroupRank(m.tier) === 0);
  const suffixes = explicitMods.filter((m) => tierGroupRank(m.tier) === 1);
  const other = explicitMods.filter((m) => tierGroupRank(m.tier) === 2);

  if (implicitMods.length > 0) {
    container.append(renderModGroup("Implicit", implicitMods));
  }
  if (prefixes.length > 0) container.append(renderModGroup("Prefix", prefixes));
  if (suffixes.length > 0) container.append(renderModGroup("Suffix", suffixes));
  if (other.length > 0) container.append(renderModGroup("Other", other));

  return container;
}

function renderResultsTable(results: PricingResult[]) {
  if (results.length === 0) {
    return el("div", { className: "muted" }, ["No listings found."]);
  }

  const table = el("table", { className: "results-table" });
  const head = el("tr", {}, [
    el("th", {}, ["Price"]),
    el("th", {}, ["Item"]),
    el("th", {}, ["Mods"]),
    el("th", {}, ["Listed"]),
  ]);
  table.append(head);

  for (const result of results) {
    const row = el("tr", {
      className: result.isMine ? "mine" : "",
      title: result.isMine ? "This is your own listing" : "",
    });
    row.append(
      el("td", { className: "price" }, [`${result.priceAmount} ${result.priceCurrency}`]),
    );
    row.append(el("td", {}, [result.displayItem?.title.join(", ") ?? "?"]));
    row.append(el("td", {}, [renderModsList(result.displayItem)]));
    row.append(el("td", { className: "muted" }, [result.relativeDate ?? ""]));
    table.append(row);
  }
  return table;
}

window.host.onParsedItem((item) => {
  currentItem = item;
  currentFilters = undefined;
  currentStats = [];
  render();
});

window.host.onParseError((error) => {
  currentItem = undefined;
  app.replaceChildren(`Parse error: ${error}`);
});

window.host.onPriceCheckResult((result) => {
  currentFilters = result.filters;
  currentStats = result.stats;
  render();
  const resultsSection = document.getElementById("results-section")!;
  resultsSection.replaceChildren(el("h1", {}, ["Results"]), renderResultsTable(result.results));
});

window.host.onPriceCheckError((error) => {
  const resultsSection = document.getElementById("results-section");
  resultsSection?.replaceChildren(el("div", { className: "muted" }, [`Search failed: ${error}`]));
});

render();
