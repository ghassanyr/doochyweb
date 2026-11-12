// Public URL normalization for the setup CLI. Buyers often type a bare domain,
// so accept that and add the right scheme. Local addresses stay on http.

export function normalizePublicUrl(input: string, port: number): string {
  const trimmed = input.trim();
  if (!trimmed) return `http://localhost:${port}`;

  let value = trimmed;
  if (!/^https?:\/\//i.test(value)) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);
    value = `${local ? "http" : "https"}://${value}`;
  }
  value = value.replace(/\/+$/, "");

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("bad protocol");
    }
  } catch {
    throw new Error("Enter a valid URL, for example https://doochy.example.com");
  }

  return value;
}
