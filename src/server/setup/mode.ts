// Database mode selection for the setup CLI.
//
// Explicit flags are unambiguous and should never prompt:
//   --db <mode>      the requested mode
//   --mongo-uri      an external database, even when the host is local
//   --mongo-port     the bundled Docker container on a local port
//
// Without flags the interactive prompt (or --yes defaults) decides.

export type DbMode = "existing" | "docker" | "external";

export interface ModeFlags {
  db?: DbMode;
  mongoUri?: string;
  mongoPort?: number;
}

/**
 * Resolve a database mode from explicit flags. Returns null when the user has
 * not chosen one and the caller should fall back to prompting or defaults.
 */
export function inferDbMode(flags: ModeFlags): DbMode | null {
  if (flags.db) return flags.db;
  if (flags.mongoUri) return "external";
  if (flags.mongoPort) return "docker";
  return null;
}
