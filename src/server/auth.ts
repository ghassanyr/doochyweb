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
}

function jwtSecret(): string {
  // Temporary minimal hardening (see project brief §2). Next iteration should
  // use an asymmetric key or rotate this via the environment on deploy.
  return process.env.JWT_SECRET || "insecure-development-secret";
}

/** Verify the bearer token and write the standard 401s. Null means stop. */
function readToken(req: Request, res: Response): { userId: string } | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing authorization header" });
    return null;
  }
  let payload: any;
  try {
    payload = jwt.verify(header.slice(7), jwtSecret());
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
    return null;
  }
  if (!payload || typeof payload.userId !== "string") {
    res.status(401).json({ error: "invalid token payload" });
    return null;
  }
  return { userId: payload.userId };
}

export function signToken(userId: string): string {
  return jwt.sign({ userId }, jwtSecret(), { expiresIn: JWT_TTL });
}

/** User id from a valid bearer token, or null. Never writes a response. */
export function tokenUserId(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    const payload: any = jwt.verify(header.slice(7), jwtSecret());
    return payload && typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}

/** Read the role from the database; used by the maintenance gate. */
export async function isAdminUser(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const user = await User.findById(userId).lean().exec();
  return ((user?.role as UserRole | undefined) ?? "user") === "admin";
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

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = readToken(req, res);
  if (!token) return;
  req.userId = token.userId;
  next();
}

/**
 * Admin-only guard. The role is read from the database on every request rather
 * than baked into the JWT, so promoting or demoting a user takes effect at once
 * and existing tokens stay valid.
 */
export async function adminRequired(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = readToken(req, res);
  if (!token) return;
  try {
    const user = await User.findById(token.userId).lean().exec();
    if (!user) {
      res.status(401).json({ error: "user no longer exists" });
      return;
    }
    const role = ((user.role as UserRole | undefined) ?? "user");
    if (role !== "admin") {
      res.status(403).json({ error: "admin access required" });
      return;
    }
    req.userId = token.userId;
    req.username = typeof user.username === "string" ? user.username : undefined;
    req.role = role;
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
