// Asset-class filters for the Analysis grid.
//
// The server's SymbolType is the source of truth. `commodity` is the broker's
// bucket for precious metals (XAU, XAG, XPT, XPD and their worded equivalents),
// so it maps to the "metals" filter. Types outside these four buckets (stocks,
// unknown) only appear under "all".

import type { SymbolType } from "./types";

export type AssetClass = "crypto" | "forex" | "metals" | "indices";
export type AssetFilter = "all" | AssetClass;

export const ASSET_FILTERS: { id: AssetFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "crypto", label: "Crypto" },
  { id: "forex", label: "Forex" },
  { id: "metals", label: "Metals" },
  { id: "indices", label: "Indices" },
];

/** The filter bucket for a server symbol type, or null when it has none. */
export function assetClass(type: SymbolType | undefined): AssetClass | null {
  switch (type) {
    case "crypto":
      return "crypto";
    case "forex":
      return "forex";
    case "commodity":
      return "metals";
    case "index":
      return "indices";
    default:
      return null;
  }
}
