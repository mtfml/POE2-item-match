import type { ParsedItem } from "../shared/parser";
import { createFilters } from "../shared/filters/create-item-filters";
import {
  initUiModFilters,
  enableGoodRolledFilters,
} from "../shared/filters/create-stat-filters";
import { FilterTag } from "../shared/filters/interfaces";
import type { ItemFilters, StatFilter } from "../shared/filters/interfaces";
import {
  createTradeRequest,
  requestTradeResultList,
  requestResults,
  PricingResult,
} from "../shared/trade/pathofexile-trade";
import { httpFetch } from "../shared/trade/http";
import { getTradeEndpoint } from "../shared/trade/common";
import { ACCOUNT_NAME } from "../shared/language";
import type { Logger } from "./Logger";

let cachedLeague: string | undefined;

export async function getDefaultLeague(logger: Logger): Promise<string> {
  if (cachedLeague) return cachedLeague;

  const response = await httpFetch(
    `https://${getTradeEndpoint()}/api/trade2/data/leagues`,
  );
  const data = (await response.json()) as { result: Array<{ id: string }> };
  cachedLeague = data.result[0]?.id ?? "Standard";
  logger.write(`info [trade] using league: ${cachedLeague}`);
  return cachedLeague;
}

export interface PriceCheckResult {
  filters: ItemFilters;
  stats: StatFilter[];
  results: PricingResult[];
}

export async function runPriceCheck(
  item: ParsedItem,
  logger: Logger,
): Promise<PriceCheckResult> {
  const league = await getDefaultLeague(logger);

  const filters = createFilters(item, {
    league,
    currency: undefined,
    listingType: undefined,
    collapseListings: "api",
    activateStockFilter: false,
    // Match the same base item precisely (searchRelaxed off) rather than any
    // item of the same category - matches EE2's default preset behavior.
    exact: true,
    useEn: true,
    autoFillEmptyAugmentSockets: false,
  });

  const stats = initUiModFilters(item, {
    // ±10% band, bounded on both sides (see filterFillMinMax) - an exact
    // 0% match essentially never finds anything against real listings. Min
    // and max are editable in the UI if you want to widen further.
    searchStatRange: 10,
    // Leave EE2's per-rule defaults in place (mostly unchecked) rather than
    // blanket-enabling everything - enableGoodRolledFilters below is the
    // actual default-selection strategy.
    defaultAllSelected: false,
  });

  // EE2 defines this but never calls it in production: it doesn't
  // auto-search on hotkey for most items, it waits for you to review/adjust
  // the checklist before manually searching (see PriceCheckWidget's
  // smartInitialSearch gating doSearch in CheckedItem.vue). This app always
  // searches immediately, so it needs a real default-selection strategy:
  // auto-select mods that rolled at/above the 50th percentile of their own
  // possible range - a well-rolled mod is presumably why the item is
  // notable, and including a poorly-rolled one by default would exclude
  // otherwise-comparable listings for no good reason. Adjust 0.5 to taste.
  enableGoodRolledFilters(stats, 0.5);

  // Socketed runes are the easiest stat on an item to swap out after
  // buying, so they shouldn't narrow the default search regardless of how
  // well they rolled - deselect them even if enableGoodRolledFilters
  // enabled one above.
  for (const stat of stats) {
    const modType = stat.sources[0]?.modifier.info.type;
    if (modType === "rune" || modType === "added-rune") {
      stat.disabled = true;
    }
  }

  // Base stats (Energy Shield/Armour/Evasion/DPS totals) are always
  // selected - they're the item's defining property, not a variable roll
  // to judge the "goodness" of.
  for (const stat of stats) {
    if (stat.tag === FilterTag.Property && !stat.hidden) {
      stat.disabled = false;
    }
  }

  const results = await searchWithFilters(item, filters, stats, logger);

  return { filters, stats, results };
}

export async function searchWithFilters(
  item: ParsedItem,
  filters: ItemFilters,
  stats: StatFilter[],
  logger: Logger,
): Promise<PricingResult[]> {
  const body = createTradeRequest(filters, stats, item);
  const search = await requestTradeResultList(body, filters.trade.league);
  logger.write(`info [trade] search matched ${search.total} listings`);

  // Only the most recent few listings matter for a fast-moving PoE2 league.
  const idsToFetch = search.result.slice(0, 5);
  if (idsToFetch.length === 0) return [];

  return requestResults(search.id, idsToFetch, { accountName: ACCOUNT_NAME });
}
