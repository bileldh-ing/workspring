import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "embedded-postgres"],
  // Keep builds within small CI/sandbox memory budgets (2 CPUs, shared RAM).
  experimental: { cpus: 1, webpackMemoryOptimizations: true },
  // `pnpm typecheck` runs tsc separately (and in CI). WS_SKIP_BUILD_TYPECHECK=1 skips the duplicate in-build
  // type-check worker on memory-starved machines; it is OFF by default.
  typescript: { ignoreBuildErrors: process.env.WS_SKIP_BUILD_TYPECHECK === "1" },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
