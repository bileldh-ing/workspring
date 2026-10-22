# Mobile: PWA + Capacitor store shell

WorkSpring is a responsive PWA (manifest, icons, service worker with an offline fallback page). For app-store distribution, `mobile/` holds a thin [Capacitor](https://capacitorjs.com/) shell that loads the **deployed** web app from `CAP_SERVER_URL`. Nothing private (secrets, user data, business logic) is bundled into the binary; `mobile/www/index.html` is only an offline fallback.

## What CI does (`.github/workflows/mobile.yml`)

Triggers: manual (`workflow_dispatch`, optional `server_url` input) and pushes to `main` that touch `mobile/**`, the manifest or the workflow.

1. Node 22, Temurin JDK 21, the Android SDK preinstalled on `ubuntu-latest`.
2. `npm install` in `mobile/` (Capacitor 7 CLI/core/android/ios).
3. `npx cap add android && npx cap sync android` (the native project is generated in CI, never committed).
4. Copies the PWA icon into the launcher mipmaps.
5. `./gradlew assembleDebug` → uploads artifact **`workspring-debug-apk`** (14 days).
6. Only if signing secrets exist: `npx cap build android --androidreleasetype AAB …` → artifact **`workspring-release-aab`**.

Repository variables (Settings → Secrets and variables → Actions → Variables):

| Variable | Example | Purpose |
|---|---|---|
| `CAP_SERVER_URL` | `https://workspring.example.com` | HTTPS origin of the deployed web app |
| `CAP_APP_ID` | `com.yourcompany.workspring` | Reverse-DNS application id (must be one you control before store submission) |

## Google Play signing (placeholders, not configured in this repo)

| Secret | How to create |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000` then `base64 -w0 upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password chosen above |
| `ANDROID_KEY_ALIAS` | `upload` (or your alias) |
| `ANDROID_KEY_PASSWORD` | key password |

Use **Play App Signing**: the key above is only your *upload* key; Google holds the app signing key. Keep the `.jks` file and passwords in a password manager; never commit them. Before a public listing you also need: a Play Console developer account, privacy-policy URL, Data safety form (account data, messages, files are collected; payments are processed by the payment provider), content rating, and screenshots (see `docs/screenshots/`).

## Apple App Store (not automated)

iOS builds need macOS + Xcode. Locally: `cd mobile && npm install && npx cap add ios && npx cap open ios`, set the bundle id and team, then archive. For CI, a `macos-latest` job would need these secrets (placeholders): `APPLE_TEAM_ID`, `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_P8`. Note App Store Review Guideline 4.2 (minimum functionality): a web wrapper must offer an app-like experience; plan native touches (push notifications, share sheet) before submitting.

## Local debug build

```bash
cd mobile
npm install
CAP_SERVER_URL=http://10.0.2.2:3000 npx cap add android   # emulator → host machine
npx cap sync android && cd android && ./gradlew assembleDebug
```

`cleartext` is enabled only when `CAP_SERVER_URL` starts with `http://`.
