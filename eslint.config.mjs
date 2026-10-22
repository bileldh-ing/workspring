import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "node_modules/**", ".data/**", "drizzle/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "mobile/android/**", "mobile/ios/**", "mobile/node_modules/**"] },
];
export default config;
