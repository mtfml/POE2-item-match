// Stand-in for EE2's renderer/src/web/background/Prices.ts. That module
// fetches poe.ninja-derived currency rates (via a custom proxy) to show
// "value in divine equivalent" next to raw trade prices - an enrichment,
// not core to "show me sale history of similar items". Skipped for v1: this
// app shows raw currency amounts from trade listings only.
export interface CoreCurrency {
  id: "exalted" | "chaos" | "div";
  abbrev: string;
  ref: string;
  text: string;
  icon: string;
}

export const DivCurrency: CoreCurrency = {
  id: "div",
  abbrev: "div",
  ref: "Divine Orb",
  text: "Divine Orb",
  icon: "/images/div.png",
};

export function displayRounding(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function usePoeninja() {
  return {
    cachedCurrencyByQuery: (
      _query: { ns: string; name: string; variant: string | undefined },
      _amount: number,
    ): { min: number; max: number; currency: "chaos" | "exalted" | "div" } | undefined =>
      undefined,
    xchgRateCurrency: { value: undefined as CoreCurrency | undefined },
  };
}
