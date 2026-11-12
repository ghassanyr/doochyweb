// Guided first-run setup:
//
//   pnpm doochy:setup
//   pnpm doochy:check
//
// The CLI runs before the server. It can start a local MongoDB with Docker,
// test an external connection, generate the secrets the server needs, write
// .env, and create or promote the first admin account.

import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import mongoose from "mongoose";

import { setRole } from "../admin/roles";
import { hashPassword } from "../auth";
import { User } from "../db";
import { runDoctor } from "./check";
import {
  COMPOSE_FILE,
  MONGO_CONTAINER,
  detectDocker,
  ensureComposeFile,
  readComposePort,
  startCompose,
  waitForMongoHealthy,
} from "./compose";
import { mergeEnvFile, parseEnv, renderNewEnvFile, writeEnvFile } from "./envFile";
import {
  DEFAULT_MONGO_URI,
  MONGO_DB_NAME,
  checkMongo,
  isLocalMongoUri,
  isMongoUri,
  redactMongoUri,
} from "./mongo";
import { Prompter } from "./prompt";
import {
  generateEncryptionKey,
  generateJwtSecret,
  generateTrainerSecret,
  isUsableJwtSecret,
  isValidEncryptionKey,
} from "./secrets";
import { normalizePublicUrl } from "./url";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const COMPOSE_PATH = path.join(REPO_ROOT, COMPOSE_FILE);
const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type DbMode = "existing" | "docker" | "external";

interface Options {
  check: boolean;
  yes: boolean;
  force: boolean;
  rotateSecrets: boolean;
  rotateEncryptionKey: boolean;
  db?: DbMode;
  mongoUri?: string;
  mongoPort?: number;
  port?: number;
  publicUrl?: string;
  admin?: string;
  adminEmail?: string;
  adminPassword?: string;
  help: boolean;
}

function parsePort(value: string, label: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be a port from 1 to 65535`);
  }
  return port;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    check: false,
    yes: false,
    force: false,
    rotateSecrets: false,
    rotateEncryptionKey: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const body = arg.slice(2);
    const equals = body.indexOf("=");
    const key = equals === -1 ? body : body.slice(0, equals);
    const inline = equals === -1 ? undefined : body.slice(equals + 1);

    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      index += 1;
      return next;
    };

    switch (key) {
      case "check":
        options.check = true;
        break;
      case "yes":
        options.yes = true;
        break;
      case "force":
        options.force = true;
        break;
      case "rotate-secrets":
        options.rotateSecrets = true;
        break;
      case "rotate-encryption-key":
        options.rotateEncryptionKey = true;
        break;
      case "db": {
        const mode = value();
        if (mode !== "existing" && mode !== "docker" && mode !== "external") {
          throw new Error("--db must be existing, docker, or external");
        }
        options.db = mode;
        break;
      }
      case "mongo-uri":
        options.mongoUri = value();
        break;
      case "mongo-port":
        options.mongoPort = parsePort(value(), "--mongo-port");
        break;
      case "port":
        options.port = parsePort(value(), "--port");
        break;
      case "public-url":
        options.publicUrl = value();
        break;
      case "admin":
        options.admin = value();
        break;
      case "admin-email":
        options.adminEmail = value();
        break;
      case "admin-password":
        options.adminPassword = value();
        break;
      case "help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option --${key}`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Doochy setup

Usage:
  pnpm doochy:setup             Guided setup
  pnpm doochy:check             Read-only diagnostics
  pnpm run setup                Same as doochy:setup
  pnpm setup:check              Same as doochy:check

Options:
  --db existing|docker|external Database mode
  --mongo-uri <uri>             External MongoDB connection string
  --mongo-port <port>           Local Docker MongoDB port (default 27017)
  --port <port>                 HTTP port (default 9111)
  --public-url <url>            Public URL used in links and callbacks
  --admin <username>            Create or promote this admin
  --admin-email <email>         Admin email, for a new account
  --admin-password <password>   Admin password, for a new account
  --rotate-secrets              Regenerate JWT_SECRET and TRAINER_ITEM_SECRET
  --rotate-encryption-key       Regenerate INTEGRATIONS_ENCRYPTION_KEY
  --force                       Rewrite docker-compose.yml with a backup
  --yes                         Use defaults, do not prompt
  --help                        Show this message
`);
}

async function askMongoUri(prompter: Prompter, defaultValue: string): Promise<string> {
  while (true) {
    const answer = await prompter.ask("MongoDB connection string", defaultValue);
    if (isMongoUri(answer)) return answer.trim();
    console.log("Enter a mongodb:// or mongodb+srv:// connection string.");
  }
}

interface AdminPlan {
  username: string;
  email?: string;
  password?: string;
}

async function bootstrapAdminInteractive(
  uri: string,
  dbName: string,
  username: string,
  prompter: Prompter
): Promise<string> {
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  try {
    const existing = await User.findOne({ username }).lean().exec();
    if (existing) {
      const result = await setRole(username, "admin");
      return result === "promoted"
        ? `Promoted "${username}" to admin.`
        : `"${username}" is already an admin.`;
    }

    const email = (await prompter.ask("Admin email")).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");

    const password = await prompter.secret("Admin password (at least 8 characters)");
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");

    const confirmation = await prompter.secret("Confirm admin password");
    if (confirmation !== password) throw new Error("Passwords do not match.");

    await User.create({
      username,
      email,
      passwordHash: await hashPassword(password),
      role: "admin",
    });
    return `Created admin "${username}".`;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
}

async function bootstrapAdminDirect(
  uri: string,
  dbName: string,
  plan: AdminPlan
): Promise<string> {
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  try {
    const existing = await User.findOne({ username: plan.username }).lean().exec();
    if (existing) {
      const result = await setRole(plan.username, "admin");
      return result === "promoted"
        ? `Promoted "${plan.username}" to admin.`
        : `"${plan.username}" is already an admin.`;
    }

    if (!plan.email || !EMAIL_RE.test(plan.email)) {
      throw new Error("A valid --admin-email is required for a new account.");
    }
    if (!plan.password || plan.password.length < 8) {
      throw new Error("--admin-password must be at least 8 characters.");
    }

    await User.create({
      username: plan.username,
      email: plan.email.toLowerCase(),
      passwordHash: await hashPassword(plan.password),
      role: "admin",
    });
    return `Created admin "${plan.username}".`;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
}

async function runSetup(options: Options, prompter: Prompter): Promise<void> {
  console.log("");
  console.log("Doochy setup");
  console.log("This writes .env, prepares MongoDB, and can create the first admin.");
  console.log("");

  const existingRaw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const existing = existingRaw.trim() ? parseEnv(existingRaw) : {};
  const existingUri = (existing.MONGO_URI ?? "").trim();

  let mongoDb = MONGO_DB_NAME;
  const existingDb = (existing.MONGO_DB ?? "").trim();
  if (existingDb && existingDb !== MONGO_DB_NAME) {
    if (options.yes) {
      mongoDb = existingDb;
    } else {
      const keep = await prompter.confirm(
        `This .env uses MONGO_DB=${existingDb}. Switching to ${MONGO_DB_NAME} will not show the existing data. Keep ${existingDb}?`,
        true
      );
      mongoDb = keep ? existingDb : MONGO_DB_NAME;
    }
  }

  const docker = detectDocker();
  const probeUri =
    existingUri && isLocalMongoUri(existingUri) ? existingUri : DEFAULT_MONGO_URI;
  const probe = await checkMongo(probeUri, mongoDb, 1500);

  let mode: DbMode;
  if (options.db) {
    mode = options.db;
  } else if (options.yes) {
    if (probe.ok) mode = "existing";
    else if (docker.docker && docker.compose && docker.daemon) mode = "docker";
    else if (options.mongoUri) mode = "external";
    else {
      throw new Error(
        "No database was detected. Pass --db docker, or --db external with --mongo-uri."
      );
    }
  } else {
    const choices: Array<{ mode: DbMode; label: string }> = [];
    if (existingUri || probe.ok) {
      choices.push({
        mode: "existing",
        label: existingUri
          ? `Use the MongoDB from .env (${redactMongoUri(existingUri)})`
          : `Use the MongoDB already running at ${DEFAULT_MONGO_URI}`,
      });
    }
    choices.push({ mode: "docker", label: "Start a local MongoDB with Docker" });
    choices.push({ mode: "external", label: "Connect to an external MongoDB" });

    const dockerReady = docker.docker && docker.compose && docker.daemon;
    const fallback = choices.findIndex(
      (choice) => choice.mode === (dockerReady ? "docker" : "external")
    );
    const defaultIndex = probe.ok
      ? Math.max(0, choices.findIndex((choice) => choice.mode === "existing"))
      : Math.max(0, fallback);

    const picked = await prompter.select(
      "How should MongoDB run?",
      choices.map((choice) => choice.label),
      defaultIndex
    );
    mode = choices[picked].mode;
  }

  let mongoUri = "";
  if (mode === "existing") {
    mongoUri = existingUri || DEFAULT_MONGO_URI;
  } else if (mode === "docker") {
    if (!docker.docker) {
      throw new Error("Docker is not installed. Install Docker or choose an external MongoDB.");
    }
    if (!docker.compose) {
      throw new Error(
        "Docker Compose v2 is not available. Update Docker or choose an external MongoDB."
      );
    }
    if (!docker.daemon) {
      throw new Error("Docker is installed but not running. Start Docker and try again.");
    }

    let mongoPort = options.mongoPort ?? 27017;
    if (fs.existsSync(COMPOSE_PATH) && !options.force) {
      const composePort = readComposePort(COMPOSE_PATH);
      if (composePort) {
        if (options.mongoPort && options.mongoPort !== composePort) {
          throw new Error(
            `The existing ${COMPOSE_FILE} publishes port ${composePort}. Use --force to rewrite it with ${options.mongoPort}.`
          );
        }
        mongoPort = composePort;
      }
    }

    const compose = ensureComposeFile(COMPOSE_PATH, mongoPort, options.force);
    if (compose.written) console.log(`Wrote ${COMPOSE_PATH}.`);
    if (compose.backup) console.log(`Backed up the previous compose file to ${compose.backup}.`);

    const started = startCompose(COMPOSE_PATH);
    if (!started.ok) {
      if (/port is already allocated/i.test(started.output)) {
        throw new Error(
          `Port ${mongoPort} is already in use. Re-run with --mongo-port <other port>.`
        );
      }
      throw new Error(`docker compose up failed:\n${started.output}`);
    }

    console.log("Waiting for MongoDB to become healthy...");
    const healthy = await waitForMongoHealthy(MONGO_CONTAINER, 60000, console.log);
    if (!healthy) {
      throw new Error(`MongoDB did not become healthy. Check: docker logs ${MONGO_CONTAINER}`);
    }
    mongoUri = `mongodb://127.0.0.1:${mongoPort}`;
  } else {
    if (options.mongoUri) {
      if (!isMongoUri(options.mongoUri)) {
        throw new Error("--mongo-uri must start with mongodb:// or mongodb+srv://");
      }
      mongoUri = options.mongoUri.trim();
    } else if (options.yes) {
      throw new Error("External mode requires --mongo-uri.");
    } else {
      const defaultValue =
        existingUri && !isLocalMongoUri(existingUri) ? existingUri : "";
      mongoUri = await askMongoUri(prompter, defaultValue);
    }
  }

  console.log(`Testing ${redactMongoUri(mongoUri)}...`);
  let check = await checkMongo(mongoUri, mongoDb, 5000);
  while (!check.ok) {
    console.log(`Connection failed: ${check.error}`);
    if (check.hint) console.log(`Hint: ${check.hint}`);

    if (options.yes || mode === "docker") {
      throw new Error("MongoDB is not reachable.");
    }

    const retry = await prompter.confirm("Try another MongoDB connection string?", true);
    if (!retry) {
      const save = await prompter.confirm(
        "Save the configuration anyway? The app will not start until MongoDB is reachable.",
        false
      );
      if (!save) throw new Error("Setup cancelled.");
      break;
    }

    mongoUri = await askMongoUri(prompter, mongoUri);
    check = await checkMongo(mongoUri, mongoDb, 5000);
  }
  if (check.ok) console.log(`Connected to MongoDB ${check.version}.`);

  let port = options.port ?? (Number(existing.PORT) || 9111);
  if (!options.yes && !options.port) {
    port = parsePort(await prompter.ask("HTTP port", String(port)), "PORT");
  }

  let publicUrl = (options.publicUrl ?? "").trim();
  if (!publicUrl) {
    const existingUrl = (existing.PUBLIC_BASE_URL ?? "").trim();
    if (options.yes) {
      publicUrl = existingUrl || `http://localhost:${port}`;
    } else {
      const hasDomain = await prompter.confirm(
        "Do you have a domain name for this installation?",
        Boolean(existingUrl && !existingUrl.includes("localhost"))
      );
      if (hasDomain) {
        publicUrl = await prompter.ask("Public URL", existingUrl);
      } else {
        publicUrl = `http://localhost:${port}`;
      }
    }
  }
  publicUrl = normalizePublicUrl(publicUrl, port);

  if (options.rotateSecrets && !options.yes) {
    const ok = await prompter.confirm(
      "Rotating JWT_SECRET signs out every user. Continue?",
      false
    );
    if (!ok) throw new Error("Setup cancelled.");
  }

  let jwtSecret = (existing.JWT_SECRET ?? "").trim();
  if (options.rotateSecrets || !isUsableJwtSecret(jwtSecret)) {
    jwtSecret = generateJwtSecret();
  }

  let encryptionKey = (existing.INTEGRATIONS_ENCRYPTION_KEY ?? "").trim();
  if (options.rotateEncryptionKey) {
    if (!options.yes) {
      const ok = await prompter.confirm(
        "Rotating the encryption key makes stored integration secrets unreadable. Continue?",
        false
      );
      if (!ok) throw new Error("Setup cancelled.");
    }
    encryptionKey = generateEncryptionKey();
  } else if (!isValidEncryptionKey(encryptionKey)) {
    if (encryptionKey) {
      console.log("The existing INTEGRATIONS_ENCRYPTION_KEY is invalid. Generating a new one.");
    }
    encryptionKey = generateEncryptionKey();
  }

  let trainerSecret = (existing.TRAINER_ITEM_SECRET ?? "").trim();
  if (options.rotateSecrets || !trainerSecret) {
    trainerSecret = generateTrainerSecret();
  }

  let adminUsername = (options.admin ?? "").trim();
  if (!options.yes && !adminUsername) {
    const wantsAdmin = await prompter.confirm("Create or promote an admin account now?", true);
    if (wantsAdmin) {
      while (true) {
        adminUsername = await prompter.ask("Admin username");
        if (USERNAME_RE.test(adminUsername)) break;
        console.log("Username must be 3 to 32 characters using letters, digits, _, or -.");
      }
    }
  } else if (
    options.yes &&
    adminUsername &&
    (!options.adminEmail || !options.adminPassword)
  ) {
    console.log(
      "Skipping admin creation: --yes also needs --admin-email and --admin-password."
    );
    adminUsername = "";
  }

  const updates: Record<string, string> = {
    PORT: String(port),
    MONGO_URI: mongoUri,
    MONGO_DB: mongoDb,
    JWT_SECRET: jwtSecret,
    INTEGRATIONS_ENCRYPTION_KEY: encryptionKey,
    TRAINER_ITEM_SECRET: trainerSecret,
    PUBLIC_BASE_URL: publicUrl,
  };

  const content = existingRaw.trim()
    ? mergeEnvFile(existingRaw, updates)
    : renderNewEnvFile(updates);
  const written = writeEnvFile(ENV_PATH, content);
  console.log(`Wrote ${ENV_PATH}${written.backup ? ` (backup: ${written.backup})` : ""}.`);

  const saved = parseEnv(fs.readFileSync(ENV_PATH, "utf8"));
  for (const [key, value] of Object.entries(updates)) {
    if (saved[key] !== value) {
      throw new Error(`Wrote ${key} incorrectly. Check ${ENV_PATH}.`);
    }
  }

  if (adminUsername) {
    try {
      const message = options.yes
        ? await bootstrapAdminDirect(mongoUri, mongoDb, {
            username: adminUsername,
            email: options.adminEmail,
            password: options.adminPassword,
          })
        : await bootstrapAdminInteractive(mongoUri, mongoDb, adminUsername, prompter);
      console.log(message);
    } catch (err) {
      console.error(`Admin setup failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error(
        "The .env file is still valid. Register the user and run pnpm admin:grant <username>."
      );
    }
  }

  console.log("");
  console.log("Setup complete.");
  console.log(`  .env:       ${ENV_PATH}`);
  console.log(`  Database:   ${redactMongoUri(mongoUri)} / ${mongoDb}`);
  console.log(`  Public URL: ${publicUrl}`);
  console.log(`  Admin:      ${adminUsername || "not created"}`);
  console.log("");
  console.log("Next steps:");
  console.log("  pnpm build");
  console.log("  pm2 start ecosystem.config.cjs");
  console.log("");
  console.log(`Open ${publicUrl} after the server starts.`);
  if (publicUrl.startsWith("http://localhost") || publicUrl.startsWith("http://127.0.0.1")) {
    console.log(
      "cTrader OAuth needs HTTPS outside localhost. Add a domain before enabling it in production."
    );
  }
}

async function main(): Promise<void> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  if (options.check) {
    process.exitCode = await runDoctor(REPO_ROOT);
    return;
  }

  const prompter = new Prompter();
  try {
    await runSetup(options, prompter);
  } finally {
    prompter.close();
    await mongoose.disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("");
  console.error(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
