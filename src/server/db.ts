import mongoose from "mongoose";

const MONGO_URI = () => process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const MONGO_DB = () => process.env.MONGO_DB || "doochy";

export async function connectDb(): Promise<void> {
  await mongoose.connect(MONGO_URI(), { dbName: MONGO_DB() });
  console.log(`[DB] Connected to ${MONGO_DB()}`);
}

export type UserRole = "user" | "admin";
export type UserStatus = "active" | "pending";

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  // Registration requires an email, but accounts created before this field
  // existed have no stored value. Sparse keeps those legacy documents out of
  // the unique index instead of treating them all as duplicate nulls.
  email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
  passwordHash: { type: String, required: true },
  // Existing accounts predate this field; a missing value is read as "user".
  role: { type: String, enum: ["user", "admin"], default: "user", index: true },
  // Approval mode creates pending users. Existing accounts are active.
  status: { type: String, enum: ["active", "pending"], default: "active", index: true },
  // Missing means verified, so accounts created before verification existed
  // are never locked out when an admin turns the policy on.
  emailVerified: { type: Boolean, default: true },
  // Incremented on password reset and invite acceptance to invalidate old JWTs.
  tokenVersion: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.model("User", userSchema);

export interface StoredAccount {
  ctid: number;
  login: number;
  broker: string;
  isLive: boolean;
  nickname?: string | null;
  color?: string | null;
}

const credentialsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  // Only manual-mode connections store their own Open API app pair. OAuth
  // connections use the platform app, so these fields stay absent.
  clientId: { type: String },
  clientSecret: { type: String },
  accessToken: { type: String, required: true },
  refreshToken: { type: String, required: true },
  accounts: { type: [{ ctid: Number, login: Number, broker: String, isLive: Boolean, nickname: String, color: String }], default: [] },
  updatedAt: { type: Date, default: Date.now },
});

export const Credentials = mongoose.model("Credentials", credentialsSchema);

export interface StoredCredentials {
  /** Null for OAuth connections, which use the platform app. */
  clientId: string | null;
  clientSecret: string | null;
  accessToken: string;
  refreshToken: string;
  accounts: StoredAccount[];
}

export async function loadCredentials(userId: string): Promise<StoredCredentials | null> {
  const doc = await Credentials.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean().exec();
  if (!doc) return null;
  return {
    clientId: typeof doc.clientId === "string" && doc.clientId ? doc.clientId : null,
    clientSecret: typeof doc.clientSecret === "string" && doc.clientSecret ? doc.clientSecret : null,
    accessToken: doc.accessToken,
    refreshToken: doc.refreshToken,
    accounts: (doc.accounts || []) as StoredAccount[],
  };
}

export interface SaveCredentialsFields {
  /** Undefined keeps the stored value; null removes it. */
  clientId?: string | null;
  /** Undefined keeps the stored value; null removes it. */
  clientSecret?: string | null;
  accessToken: string;
  refreshToken: string;
  accounts: StoredAccount[];
}

export async function saveCredentials(
  userId: string,
  fields: SaveCredentialsFields
): Promise<void> {
  const { clientId, clientSecret, ...rest } = fields;
  const $set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  const $unset: Record<string, unknown> = {};

  if (clientId === null) $unset.clientId = "";
  else if (clientId !== undefined) $set.clientId = clientId;

  if (clientSecret === null) $unset.clientSecret = "";
  else if (clientSecret !== undefined) $set.clientSecret = clientSecret;

  await Credentials.findOneAndUpdate(
    { userId: new mongoose.Types.ObjectId(userId) },
    Object.keys($unset).length > 0 ? { $set, $unset } : { $set },
    { upsert: true }
  );
}
