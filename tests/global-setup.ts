// Starts a REAL PostgreSQL 17 (embedded-postgres) on a throwaway data dir and applies all migrations.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../scripts/migrate-lib";
import { startEmbeddedPostgres } from "../scripts/pg";

export default async function setup() {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    await runMigrations(process.env.DATABASE_URL);
    return;
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspring-test-pg-"));
  const port = 55000 + Math.floor(Math.random() * 900);
  const { pg, url } = await startEmbeddedPostgres({ dataDir, port, database: "workspring_test" });
  process.env.DATABASE_URL = url;
  await runMigrations(url);
  return async () => {
    await pg.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
}
