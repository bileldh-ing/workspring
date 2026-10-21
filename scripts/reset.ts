// Drops and recreates the public schema, then re-applies migrations. DEV ONLY.
import postgres from "postgres";
import { loadEnv } from "./env";
import { runMigrations } from "./migrate-lib";

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset in production");
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql`drop schema if exists public cascade`;
await sql`drop schema if exists drizzle cascade`;
await sql`create schema public`;
await sql.end();
await runMigrations(url);
console.log("[db] reset complete");
