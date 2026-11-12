// MongoDB helpers for the setup CLI. The app's own connectDb() reads from
// process.env, which is not useful before .env exists, so setup opens short
// lived connections to the URI it is about to write.

import mongoose from "mongoose";

export const DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27017";
export const MONGO_DB_NAME = "doochy";

export function isMongoUri(value: string): boolean {
  return /^mongodb(\+srv)?:\/\/\S+$/i.test(value.trim());
}

/** Remove user and password from a URI before it reaches a log line. */
export function redactMongoUri(uri: string): string {
  return uri
    .replace(/(mongodb(?:\+srv)?:\/\/)([^@/]+)@/i, "$1***:***@")
    .replace(/([?&](?:password|authMechanismProperties)=)[^&]*/gi, "$1***");
}

export function isLocalMongoUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export interface MongoCheck {
  ok: boolean;
  version?: string;
  error?: string;
  hint?: string;
}

function hintFor(message: string): string {
  if (/ECONNREFUSED|connect ECONNREFUSED/i.test(message)) {
    return "Nothing is listening at that address. Start MongoDB or check the port.";
  }
  if (/Authentication failed|bad auth|SCRAM/i.test(message)) {
    return "The username, password, or authSource is wrong.";
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|Server selection timed out|querySrv/i.test(message)) {
    return "The host cannot be reached. Check the address, network, and Atlas IP allowlist.";
  }
  if (/SSL|TLS|certificate/i.test(message)) {
    return "TLS failed. Check the TLS options in the connection string.";
  }
  return "Check the connection string and make sure MongoDB is running.";
}

/**
 * Connect, ping, read the server version, and close. The error is redacted so
 * a URI with credentials can be shown safely.
 */
export async function checkMongo(
  uri: string,
  dbName: string = MONGO_DB_NAME,
  timeoutMs = 5000
): Promise<MongoCheck> {
  let connection: mongoose.Connection | null = null;

  try {
    connection = mongoose.createConnection(uri, {
      dbName,
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
    });
    await connection.asPromise();
    const db = connection.db;
    if (!db) throw new Error("connection has no database handle");
    const info = await db.admin().command({ buildInfo: 1 });
    return { ok: true, version: String(info.version ?? "unknown") };
  } catch (err) {
    const message = redactMongoUri(err instanceof Error ? err.message : String(err));
    return { ok: false, error: message, hint: hintFor(message) };
  } finally {
    try {
      await connection?.close();
    } catch {
      // The connection may already be gone after a failed handshake.
    }
  }
}
