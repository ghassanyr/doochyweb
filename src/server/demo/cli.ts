import "dotenv/config";

import { connectDb } from "../db";
import { demoStatus, ensureDemoUser, resetDemoUser } from "./store";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "status";
  await connectDb();
  try {
    if (command === "seed") {
      const status = await ensureDemoUser();
      console.log(`[demo] seeded user ${status.userId} (version ${status.seedVersion})`);
    } else if (command === "reset") {
      const status = await resetDemoUser();
      console.log(`[demo] reset complete (count ${status.resetCount})`);
    } else if (command === "status") {
      console.log(JSON.stringify(await demoStatus(), null, 2));
    } else {
      console.error("Usage: pnpm demo:seed | pnpm demo:reset | pnpm demo:status");
      process.exitCode = 1;
    }
  } finally {
    const mongoose = await import("mongoose");
    await mongoose.disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(`[demo] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
