// Generated fallback mark for white-label deployments that have not uploaded a
// logo. Keeping this pure lets the branding helpers be tested without a DOM.

export function brandInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function monogramDataUrl(
  name: string,
  accent: string,
  accentFg: string,
  size = 64
): string {
  const initials = escapeXml(brandInitials(name));
  const fontSize = initials.length > 1 ? 25 : 34;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${escapeXml(accent)}"/>` +
    `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="Inter,Arial,sans-serif" font-size="${fontSize}" font-weight="700" ` +
    `fill="${escapeXml(accentFg)}">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
