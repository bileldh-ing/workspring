import { loadEnv } from "./env";
import { runMigrations } from "./migrate-lib";

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
await runMigrations(url);
console.log("[db] migrations applied");
