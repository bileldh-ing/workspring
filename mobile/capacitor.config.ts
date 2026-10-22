/**
 * Capacitor configuration for the WorkSpring store shell.
 * The native app is a thin wrapper: it loads the deployed PWA from CAP_SERVER_URL (https in production).
 * No business logic, secrets or user data are bundled into the binary. `www/` only holds an offline fallback.
 * (Plain object, no @capacitor/cli import, so the root typecheck does not need Capacitor installed.)
 */
const serverUrl = process.env.CAP_SERVER_URL || "https://workspring.fly.dev";
const isHttp = serverUrl.startsWith("http://");

const config = {
  appId: process.env.CAP_APP_ID || "test.workspring.app",
  appName: "WorkSpring",
  webDir: "www",
  server: {
    url: serverUrl,
    // Only allow cleartext for local/dev builds pointed at http:// (e.g. an emulator hitting 10.0.2.2:3000).
    cleartext: isHttp,
    androidScheme: "https",
    allowNavigation: [new URL(serverUrl).host],
  },
  android: { allowMixedContent: false },
};

export default config;
