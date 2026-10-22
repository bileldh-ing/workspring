/** Runs once per server process at boot: validates configuration before serving traffic. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv } = await import("./lib/env");
  const r = validateEnv();
  if (!r.ok) {
    const msg = `[env] invalid configuration:\n  - ${r.problems.join("\n  - ")}`;
    if (process.env.NODE_ENV === "production" && process.env.WS_ALLOW_INVALID_ENV !== "1") {
      console.error(msg);
      throw new Error("Invalid environment configuration (see log above)");
    }
    console.warn(msg);
  }
}
