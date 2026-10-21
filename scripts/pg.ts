import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

/** Starts (initialising if needed) an embedded, real PostgreSQL server. */
export async function startEmbeddedPostgres(opts: { dataDir: string; port: number; database: string }) {
  const dataDir = path.resolve(opts.dataDir);
  const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port: opts.port,
    persistent: true,
    onLog: () => {},
    onError: (e) => {
      const msg = String(e);
      if (!/database system is shut down|NOTICE/.test(msg)) console.error("[postgres]", msg.trim().slice(0, 500));
    },
  });
  if (fresh) {
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    await pg.initialise();
  }
  // A stale postmaster.pid after a crash/sandbox restart would block startup.
  const pid = path.join(dataDir, "postmaster.pid");
  if (fs.existsSync(pid)) {
    const owner = Number(fs.readFileSync(pid, "utf8").split("\n")[0]);
    let alive = false;
    try {
      process.kill(owner, 0);
      alive = true;
    } catch {}
    if (!alive) fs.rmSync(pid);
    else throw new Error(`Postgres already running (pid ${owner}) on ${dataDir}`);
  }
  try {
    await pg.start();
  } catch (e) {
    throw new Error(`PostgreSQL failed to start on port ${opts.port} (${e ?? "no detail"}). Is the port already in use? Set WS_PG_PORT to another port.`);
  }
  try {
    await pg.createDatabase(opts.database);
  } catch (e) {
    if (!/already exists/.test(String(e))) throw e;
  }
  return { pg, url: `postgres://postgres:postgres@127.0.0.1:${opts.port}/${opts.database}`, fresh };
}
