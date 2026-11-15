import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { User, type UserRole } from "./db";

const BCRYPT_ROUNDS = 10;
const JWT_TTL = "7d";

export interface AuthedRequest extends Request {
  userId?: string;
  username?: string;
  role?: UserRole;
  tokenVersion?: number;
}

export interface SessionUser {
  id: string;
  username: string | null;
  role: UserRole;
  tokenVersion: number;
}

interface TokenPayload {
  userId: string;
  v?: number;
}

function jwtSecret(): string {
  // Temporary minimal hardening (see project brief §2). Next iteration should
  // use an asymmetric key or rotate this via the environment on deploy.
  return process.env.JWT_SECRET || "insecure-development-secret";
}

function readPayload(req: Request): TokenPayload | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    const payload: any = jwt.verify(header.slice(7), jwtSecret());
    if (!payload || typeof payload.userId !== "string") return null;
    return { userId: payload.userId, v: typeof payload.v === "number" ? payload.v : 0 };
  } catch {
    return null;
  }
}

export function signToken(userId: string, tokenVersion = 0): string {
  return jwt.sign({ userId, v: tokenVersion }, jwtSecret(), { expiresIn: JWT_TTL });
}

/**
 * Verify the token signature and the account's current token version. Password
 * resets and invite acceptance bump the version, which invalidates every JWT
 * issued before the change.
 */
export async function sessionFromRequest(req: Request): Promise<SessionUser | null> {
  const payload = readPayload(req);
  if (!payload) return null;
  const user: any = await User.findById(payload.userId).lean().exec();
  if (!user) return null;
  const current = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
  if ((payload.v ?? 0) !== current) return null;
  return {
    id: String(user._id ?? payload.userId),
    username: typeof user.username === "string" ? user.username : null,
    role: user.role === "admin" ? "admin" : "user",
    tokenVersion: current,
  };
}

/** User id from a valid bearer token, or null. Never writes a response. */
export async function tokenUserId(req: Request): Promise<string | null> {
  const session = await sessionFromRequest(req);
  return session?.id ?? null;
}

// Short-lived state carried through the cTrader OAuth browser round-trip. The
// signature is what proves which Doochy user started the flow: the callback
// is a top-level navigation and cannot send the normal Authorization header.
const OAUTH_STATE_PURPOSE = "ctrader-oauth";
const OAUTH_STATE_TTL = "10m";

export function signOAuthState(userId: string): string {
  return jwt.sign({ userId, purpose: OAUTH_STATE_PURPOSE }, jwtSecret(), { expiresIn: OAUTH_STATE_TTL });
}

/** Returns the user id for a valid, unexpired OAuth state, else null. */
export function verifyOAuthState(state: string): string | null {
  try {
    const payload: any = jwt.verify(state, jwtSecret());
    if (!payload || payload.purpose !== OAUTH_STATE_PURPOSE || typeof payload.userId !== "string") {
      return null;
    }
    return payload.userId;
  } catch {
    return null;
  }
}

export async function authRequired(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: "invalid or expired token" });
      return;
    }
    req.userId = session.id;
    req.username = session.username ?? undefined;
    req.role = session.role;
    req.tokenVersion = session.tokenVersion;
    next();
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to verify session" });
  }
}

/**
 * Admin-only guard. The role is read from the database on every request rather
 * than baked into the JWT, so promoting or demoting a user takes effect at once
 * and existing tokens stay valid.
 */
export async function adminRequired(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await sessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: "invalid or expired token" });
      return;
    }
    if (session.role !== "admin") {
      res.status(403).json({ error: "admin access required" });
      return;
    }
    req.userId = session.id;
    req.username = session.username ?? undefined;
    req.role = session.role;
    req.tokenVersion = session.tokenVersion;
    next();
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed to verify role" });
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function findUserByUsername(username: string) {
  return User.findOne({ username }).exec();
}
