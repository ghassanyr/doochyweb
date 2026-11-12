// Docker Compose helpers for the setup CLI.
//
// The compose file runs MongoDB only. The app keeps running under pm2, which
// matches the existing deployment and avoids binding the app inside a container
// while it listens on 127.0.0.1.
//
// Security note: the database is published on loopback only and runs without
// authentication. This is intentional for a single-VPS install. Revisit before
// exposing the host or moving MongoDB to a shared machine.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const COMPOSE_FILE = "docker-compose.yml";
export const MONGO_SERVICE = "mongo";
export const MONGO_CONTAINER = "doochy-mongo";
export const MONGO_VOLUME = "doochy-mongo-data";

export function renderCompose(port: number): string {
  return [
    "services:",
    "  mongo:",
    "    image: mongo:7.0",
    `    container_name: ${MONGO_CONTAINER}`,
    "    restart: unless-stopped",
    "    ports:",
    `      - "127.0.0.1:${port}:27017"`,
    "    volumes:",
    `      - ${MONGO_VOLUME}:/data/db`,
    "    healthcheck:",
    '      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand(\'ping\').ok"]',
    "      interval: 10s",
    "      timeout: 5s",
    "      retries: 10",
    "      start_period: 20s",
    "",
    "volumes:",
    `  ${MONGO_VOLUME}:`,
    "",
  ].join("\n");
}

export interface DockerState {
  docker: boolean;
  compose: boolean;
  daemon: boolean;
}

function commandOk(command: string, args: string[], timeoutMs = 8000): boolean {
  const result = spawnSync(command, args, { stdio: "ignore", timeout: timeoutMs });
  return result.status === 0;
}

export function detectDocker(): DockerState {
  const docker = commandOk("docker", ["--version"]);
  const compose = docker && commandOk("docker", ["compose", "version"]);
  const daemon = docker && commandOk("docker", ["info", "--format", "{{.ServerVersion}}"]);
  return { docker, compose, daemon };
}

export interface CommandResult {
  ok: boolean;
  output: string;
}

export function runDocker(
  args: string[],
  options: { timeoutMs?: number; inherit?: boolean } = {}
): CommandResult {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: options.timeoutMs,
    stdio: options.inherit ? "inherit" : "pipe",
  });
  const output = [result.stdout, result.stderr]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join("\n")
    .trim();
  return {
    ok: result.status === 0,
    output: result.error ? result.error.message : output,
  };
}

/** Published loopback port from an existing compose file, if present. */
export function readComposePort(filePath: string): number | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = /127\.0\.0\.1:(\d+):27017/.exec(content);
    if (!match) return null;
    const port = Number(match[1]);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export interface ComposeWriteResult {
  written: boolean;
  backup: string | null;
}

export function ensureComposeFile(
  filePath: string,
  port: number,
  force: boolean
): ComposeWriteResult {
  if (fs.existsSync(filePath) && !force) {
    return { written: false, backup: null };
  }

  let backup: string | null = null;
  if (fs.existsSync(filePath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = `${filePath}.backup-${stamp}`;
    fs.copyFileSync(filePath, backup);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, renderCompose(port), "utf8");
  return { written: true, backup };
}

export function validateCompose(filePath: string): CommandResult {
  return runDocker(
    ["compose", "-f", filePath, "--project-directory", path.dirname(filePath), "config", "-q"],
    { timeoutMs: 15000 }
  );
}

export function startCompose(filePath: string): CommandResult {
  return runDocker([
    "compose",
    "-f",
    filePath,
    "--project-directory",
    path.dirname(filePath),
    "up",
    "-d",
    MONGO_SERVICE,
  ]);
}

export function containerHealth(container: string = MONGO_CONTAINER): string | null {
  const result = runDocker([
    "inspect",
    "--format",
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
    container,
  ]);
  return result.ok ? result.output.trim() : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll the container healthcheck. Returns true for healthy or running. */
export async function waitForMongoHealthy(
  container: string = MONGO_CONTAINER,
  timeoutMs = 60000,
  log: (message: string) => void = () => {}
): Promise<boolean> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    const health = containerHealth(container);
    if (health && health !== last) {
      log(`  MongoDB container: ${health}`);
      last = health;
    }
    if (health === "healthy" || health === "running") return true;
    if (health === "unhealthy" || health === "exited" || health === "dead") return false;
    await delay(2000);
  }
  return false;
}
