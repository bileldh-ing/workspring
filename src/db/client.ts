import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction; services accept either. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;

type Holder = { sql: postgres.Sql; db: DB; url: string };
const g = globalThis as unknown as { __workspringDb?: Holder };

export function createDb(url: string, max = 10): Holder {
  const client = postgres(url, { max, prepare: true, onnotice: () => {} });
  return { sql: client, db: drizzle(client, { schema }), url };
}

/** Process-wide database (reused across Next.js dev HMR reloads). */
export function getDb(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See docs/LOCAL_SETUP.md");
  if (!g.__workspringDb || g.__workspringDb.url !== url) {
    g.__workspringDb = createDb(url);
  }
  return g.__workspringDb.db;
}

export async function closeDb() {
  if (g.__workspringDb) {
    await g.__workspringDb.sql.end({ timeout: 5 });
    g.__workspringDb = undefined;
  }
}

export { schema };
