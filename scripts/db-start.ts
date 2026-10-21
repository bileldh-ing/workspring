// Runs a real PostgreSQL 17 server (embedded-postgres binaries) in the foreground.
// Usage: pnpm db:start   (Ctrl+C to stop)
import { loadEnv } from "./env";
import { startEmbeddedPostgres } from "./pg";

loadEnv();
const dataDir = process.env.WS_PG_DATA ?? ".data/pg";
const port = Number(process.env.WS_PG_PORT ?? 54329);

const { pg, url, fresh } = await startEmbeddedPostgres({ dataDir, port, database: "workspring" });
console.log(`[db] PostgreSQL ${fresh ? "initialised and " : ""}running at ${url} (data: ${dataDir})`);
const stop = async () => {
  console.log("[db] stopping…");
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
