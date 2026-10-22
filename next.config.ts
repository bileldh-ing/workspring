import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Content Security Policy. Next.js App Router injects inline bootstrap scripts, so script-src allows
// 'unsafe-inline' (no 'unsafe-eval' in production). Nonce-based CSP is a documented follow-up (SECURITY_PRIVACY.md).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${process.env.LIVEKIT_URL ? ` ${process.env.LIVEKIT_URL.replace(/^http/, "ws")}` : ""}`,
  "media-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isProd && process.env.APP_URL?.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
  ...(isProd && process.env.APP_URL?.startsWith("https://") ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "embedded-postgres"],
  // Keep builds within small CI/sandbox memory budgets (2 CPUs, shared RAM).
  experimental: { cpus: 1, webpackMemoryOptimizations: true, serverActions: { bodySizeLimit: "12mb" } },
  // `pnpm typecheck` runs tsc separately (and in CI). WS_SKIP_BUILD_TYPECHECK=1 skips the duplicate in-build
  // type-check worker on memory-starved machines; it is OFF by default.
  typescript: { ignoreBuildErrors: process.env.WS_SKIP_BUILD_TYPECHECK === "1" },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
