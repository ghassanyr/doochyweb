// Read-only diagnostics for an existing installation.
//
// pnpm doochy:check answers "why is the app not starting?" without changing any
// file or database. It exits non-zero when a required check fails.

import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import mongoose from "mongoose";

import { User } from "../db";
import {
  COMPOSE_FILE,
  MONGO_CONTAINER,
  containerHealth,
  detectDocker,
  validateCompose,
} from "./compose";
import { checkMongo, isMongoUri, MONGO_DB_NAME, redactMongoUri } from "./mongo";
import { isUsableJwtSecret, isValidEncryptionKey } from "./secrets";

type Status = "pass" | "warn" | "fail";

interface CheckResult {
  name: string;
  status: Status;
  detail: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function push(
  results: CheckResult[],
  name: string,
  status: Status,
  detail: string
): void {
  results.push({ name, status, detail });
}

async function adminCheck(uri: string, dbName: string): Promise<CheckResult> {
  try {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
    const exists = await User.exists({ role: "admin" });
    return {
      name: "Admin account",
      status: exists ? "pass" : "warn",
      detail: exists
        ? "at least one admin exists"
        : "no admin found; register a user then run pnpm admin:grant <username>",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: "Admin account",
      status: "fail",
      detail: redactMongoUri(message),
    };
  } finally {
    try {
      await mongoose.disconnect();
    } catch {
      // Already closed or never connected.
    }
  }
}

export async function runDoctor(repoRoot: string): Promise<number> {
  const results: CheckResult[] = [];
  const envPath = path.join(repoRoot, ".env");

  const major = Number(process.versions.node.split(".")[0]);
  push(
    results,
    "Node version",
    major >= 20 ? "pass" : major >= 18 ? "warn" : "fail",
    `${process.versions.node}${major >= 20 ? "" : " (Node 20 or newer is recommended)"}`
  );

  if (!fs.existsSync(envPath)) {
    push(results, ".env", "fail", `missing at ${envPath}; run pnpm doochy:setup`);
  } else {
    push(results, ".env", "pass", envPath);
  }

  const env = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath, "utf8"))
    : {};

  const mongoUri = (env.MONGO_URI ?? "").trim();
  const mongoDb = (env.MONGO_DB ?? "").trim();

  if (!mongoUri) {
    push(results, "MONGO_URI", "fail", "missing; run pnpm doochy:setup");
  } else if (!isMongoUri(mongoUri)) {
    push(results, "MONGO_URI", "fail", `not a MongoDB URI: ${redactMongoUri(mongoUri)}`);
  } else {
    push(results, "MONGO_URI", "pass", redactMongoUri(mongoUri));
  }

  if (!mongoDb) {
    push(results, "MONGO_DB", "fail", "missing; run pnpm doochy:setup");
  } else if (mongoDb !== MONGO_DB_NAME) {
    push(
      results,
      "MONGO_DB",
      "warn",
      `${mongoDb} (new installs use ${MONGO_DB_NAME})`
    );
  } else {
    push(results, "MONGO_DB", "pass", mongoDb);
  }

  const jwtSecret = (env.JWT_SECRET ?? "").trim();
  push(
    results,
    "JWT_SECRET",
    isUsableJwtSecret(jwtSecret) ? "pass" : "fail",
    isUsableJwtSecret(jwtSecret) ? "present" : "missing or shorter than 32 characters"
  );

  const encryptionKey = (env.INTEGRATIONS_ENCRYPTION_KEY ?? "").trim();
  push(
    results,
    "INTEGRATIONS_ENCRYPTION_KEY",
    isValidEncryptionKey(encryptionKey) ? "pass" : "fail",
    isValidEncryptionKey(encryptionKey)
      ? "valid 32-byte base64 key"
      : "missing or not a valid 32-byte base64 key"
  );

  const trainerSecret = (env.TRAINER_ITEM_SECRET ?? "").trim();
  push(
    results,
    "TRAINER_ITEM_SECRET",
    trainerSecret ? "pass" : "warn",
    trainerSecret ? "present" : "missing; trainer links will change after a restart"
  );

  const publicUrl = (env.PUBLIC_BASE_URL ?? "").trim();
  push(
    results,
    "PUBLIC_BASE_URL",
    publicUrl && isHttpUrl(publicUrl) ? "pass" : "fail",
    publicUrl && isHttpUrl(publicUrl) ? publicUrl : "missing or not an http(s) URL"
  );

  let mongoOk = false;
  if (mongoUri && isMongoUri(mongoUri)) {
    const check = await checkMongo(mongoUri, mongoDb || MONGO_DB_NAME);
    mongoOk = check.ok;
    push(
      results,
      "MongoDB",
      check.ok ? "pass" : "fail",
      check.ok ? `connected, server ${check.version}` : `${check.error} ${check.hint ?? ""}`.trim()
    );
  } else {
    push(results, "MongoDB", "fail", "skipped because MONGO_URI is invalid");
  }

  if (mongoOk) {
    results.push(await adminCheck(mongoUri, mongoDb || MONGO_DB_NAME));
  } else {
    push(results, "Admin account", "warn", "skipped because MongoDB is unreachable");
  }

  const serverBuild = path.join(repoRoot, "dist", "server", "index.js");
  const webBuild = path.join(repoRoot, "webapp", "dist", "index.html");
  push(
    results,
    "Server build",
    fs.existsSync(serverBuild) ? "pass" : "warn",
    fs.existsSync(serverBuild) ? serverBuild : "missing; run pnpm build"
  );
  push(
    results,
    "Web build",
    fs.existsSync(webBuild) ? "pass" : "warn",
    fs.existsSync(webBuild) ? webBuild : "missing; run pnpm build"
  );

  const composePath = path.join(repoRoot, COMPOSE_FILE);
  if (fs.existsSync(composePath)) {
    const docker = detectDocker();
    if (!docker.docker) {
      push(results, "Docker", "fail", "docker is not installed");
    } else if (!docker.compose) {
      push(results, "Docker Compose", "fail", "docker compose v2 is not available");
    } else if (!docker.daemon) {
      push(results, "Docker daemon", "fail", "docker is installed but not running");
    } else {
      push(results, "Docker daemon", "pass", "running");
      const valid = validateCompose(composePath);
      push(
        results,
        "Compose file",
        valid.ok ? "pass" : "fail",
        valid.ok ? composePath : valid.output || "docker compose config failed"
      );
      const health = containerHealth(MONGO_CONTAINER);
      push(
        results,
        "MongoDB container",
        health === "healthy" || health === "running" ? "pass" : "warn",
        health ?? `${MONGO_CONTAINER} not found; run docker compose up -d`
      );
    }
  } else {
    push(results, "Docker Compose", "pass", "no docker-compose.yml; using an external MongoDB");
  }

  const width = Math.max(4, ...results.map((entry) => entry.name.length));
  console.log("");
  console.log("Doochy setup check");
  console.log("");
  for (const entry of results) {
    console.log(
      `${entry.status.toUpperCase().padEnd(5)} ${entry.name.padEnd(width)}  ${entry.detail}`
    );
  }

  const failures = results.filter((entry) => entry.status === "fail").length;
  const warnings = results.filter((entry) => entry.status === "warn").length;
  console.log("");
  console.log(
    failures > 0
      ? `${failures} check(s) failed${warnings ? `, ${warnings} warning(s)` : ""}.`
      : warnings > 0
        ? `All required checks passed, ${warnings} warning(s).`
        : "All checks passed."
  );
  return failures > 0 ? 1 : 0;
}
