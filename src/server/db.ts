import mongoose from "mongoose";

const MONGO_URI = () => process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const MONGO_DB = () => process.env.MONGO_DB || "doochyweb";

export async function connectDb(): Promise<void> {
  await mongoose.connect(MONGO_URI(), { dbName: MONGO_DB() });
  console.log(`[DB] Connected to ${MONGO_DB()}`);
}

export type UserRole = "user" | "admin";

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  // Existing accounts predate this field; a missing value is read as "user".
  role: { type: String, enum: ["user", "admin"], default: "user", index: true },
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
  clientId: { type: String, required: true },
  clientSecret: { type: String, required: true },
  accessToken: { type: String, required: true },
  refreshToken: { type: String, required: true },
  accounts: { type: [{ ctid: Number, login: Number, broker: String, isLive: Boolean, nickname: String, color: String }], default: [] },
  updatedAt: { type: Date, default: Date.now },
});

export const Credentials = mongoose.model("Credentials", credentialsSchema);

export async function loadCredentials(userId: string): Promise<{
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  accounts: StoredAccount[];
} | null> {
  const doc = await Credentials.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean().exec();
  if (!doc) return null;
  return {
    clientId: doc.clientId,
    clientSecret: doc.clientSecret,
    accessToken: doc.accessToken,
    refreshToken: doc.refreshToken,
    accounts: (doc.accounts || []) as StoredAccount[],
  };
}

export async function saveCredentials(
  userId: string,
  fields: { clientId: string; clientSecret: string; accessToken: string; refreshToken: string; accounts: StoredAccount[] }
): Promise<void> {
  await Credentials.findOneAndUpdate(
    { userId: new mongoose.Types.ObjectId(userId) },
    { $set: { ...fields, updatedAt: new Date() } },
    { upsert: true }
  );
}
