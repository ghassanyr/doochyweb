export function initialView(
  search: string,
  hostname: string
): "trading" | "analysis" | "breakouts" | "learn" {
  const params = new URLSearchParams(search);
  if (params.get("view") === "learn") return "learn";

  const host = hostname.toLowerCase();
  if (host === "learn.doochy.net" || host.startsWith("learn.")) return "learn";

  if (params.has("note")) return "breakouts";
  return "analysis";
}
