// One-off admin role management:
//   pnpm admin:grant <username>
//   pnpm admin:revoke <username>
//
// Normal promotion can also happen at boot via ADMIN_USERNAME.

import "dotenv/config";
import mongoose from "mongoose";

import { connectDb } from "../db";
import { setRole } from "./roles";

const [action, username] = process.argv.slice(2);

async function main(): Promise<void> {
  if ((action !== "grant" && action !== "revoke") || !username) {
    console.error("usage: pnpm admin:grant <username> | pnpm admin:revoke <username>");
    process.exitCode = 1;
    return;
  }

  await connectDb();
  const result = await setRole(username, action === "grant" ? "admin" : "user");
  switch (result) {
    case "promoted":
      console.log(`Promoted "${username}" to admin`);
      break;
    case "already_admin":
      console.log(`"${username}" is already an admin`);
      break;
    case "demoted":
      console.log(`Demoted "${username}" to user`);
      break;
    case "not_admin":
      console.log(`"${username}" is not an admin`);
      break;
    case "last_admin":
      console.error(`Refusing to demote "${username}": it is the last admin`);
      process.exitCode = 1;
      break;
    case "missing":
      console.error(`No user named "${username}"`);
      process.exitCode = 1;
      break;
  }
}

main()
  .catch((err) => {
    console.error("[ADMIN] Failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void mongoose.disconnect();
  });
