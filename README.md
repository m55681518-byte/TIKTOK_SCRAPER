# TikGrab — TikTok → MP4 in one tap

> **📦 Current primary deliverable: [`tiktok-downloader-pwa/`](tiktok-downloader-pwa/)** —
> installable **PWA + Express** with Android share-sheet (Web Share Target)
> support and one-command HTTPS deployment (Render/Vercel). Start there.
>
> The original native-Flutter implementation (kept for reference; avoids
> nothing but app-store friction is gone in the PWA) lives in
> [`frontend/`](frontend/) + [`backend/`](backend/).

A complete, end-to-end mobile application: **share a TikTok video to the app and it lands in your gallery, watermark-free.** No in-app browsing, no extra taps.

```
┌────────────┐   Share sheet    ┌─────────────────────────┐   POST /api/download   ┌──────────────────────┐
│  TikTok    │ ───────────────► │  TikGrab (Flutter)      │ ─────────────────────► │  Express backend     │
│  app       │  vm.tiktok.com/… │  • ShareHandler         │   { "url": "…" }       │  • validate + clean  │
└────────────┘                  │  • ApiService (dio)     │                        │  • forward to        │
                                │  • DownloadService      │ ◄───────────────────── │    RapidAPI scraper  │
                                │  • progress 0→100%      │  { downloadUrl: .mp4 } │  • normalise JSON    │
                                └───────────┬─────────────┘                        └──────────────────────┘
                                            │ streams MP4 with progress                      ▲
                                            ▼                                                │ x-rapidapi-key (server-side only)
                                ┌─────────────────────────┐                        ┌──────────────────────┐
                                │ iOS Photos / Android    │                        │  RapidAPI TikTok     │
                                │ gallery ("TikGrab")     │                        │  Downloader API      │
                                └─────────────────────────┘                        └──────────────────────┘
```

> ⚠️ **Legal & ethical note** — This tool is intended for downloading videos **you own** or have **explicit permission** to save, for personal backup purposes. Removing watermarks and re-uploading other creators' content violates TikTok's Terms of Service and may infringe copyright. You are responsible for how you use this software.

---

## Directory structure

```
TIKTOK_SCRAPER/
├── README.md                          ← this file
├── backend/                           ← Node.js + Express API
│   ├── package.json
│   ├── .env                           ← real secrets (git-ignored, never committed)
│   ├── .env.example                   ← documented template
│   ├── .gitignore
│   └── server.js                      ← complete server: config, URL cleaning,
│                                        RapidAPI client, parsing, routes, errors
└── frontend/                          ← Flutter app (iOS + Android)
    ├── pubspec.yaml                   ← receive_sharing_intent, dio, path_provider,
    │                                    gallery_saver_plus, permission_handler
    ├── analysis_options.yaml
    ├── .gitignore
    ├── lib/
    │   ├── main.dart                  ← entry point
    │   ├── app.dart                   ← MaterialApp, dark theme, routing
    │   ├── core/
    │   │   ├── app_config.dart        ← BACKEND_URL via --dart-define
    │   │   ├── app_colors.dart        ← TikTok palette
    │   │   ├── format.dart            ← bytes/duration helpers
    │   │   └── tiktok_url_parser.dart ← extract + clean links from shared text
    │   ├── models/
    │   │   └── tiktok_video.dart      ← backend response model
    │   ├── services/
    │   │   ├── share_handler.dart     ← native share intents (+ native setup docs)
    │   │   ├── api_service.dart       ← dio client for /api/download
    │   │   └── download_service.dart  ← MP4 download w/ progress + gallery save
    │   └── screens/
    │       └── home_screen.dart       ← UI: paste field, button, progress bar
    └── native_setup/                  ← paste-ready platform files
        ├── android/AndroidManifest.xml
        └── ios/
            ├── ShareViewController.swift
            └── share_extension_Info.plist
```

---

## Phase 2 — Backend (Node.js + Express)

### Why a backend?
The RapidAPI key is a secret — bundling it into the mobile binary leaks it to every user and burns the quota. The backend also validates/cleans URLs, rate-limits abuse, and lets you swap scraper vendors without shipping a new app build.

### Setup

```bash
cd backend
npm install
cp .env.example .env    # then paste your RAPIDAPI_KEY (already provided in .env here)
npm run dev             # or: npm start
```

The server listens on `http://0.0.0.0:3000`.

### Environment variables (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `ALLOWED_ORIGINS` | `*` | CORS allowlist (comma-separated) — lock down in production |
| `RAPIDAPI_HOST` | `tiktok-downloader-download-tiktok-videos-without-watermark.p.rapidapi.com` | Scraper host |
| `RAPIDAPI_KEY` | — | **Required.** Your RapidAPI key (server-side only) |
| `RAPIDAPI_PATH` | `/` | Scraper endpoint path (takes `?url=`) |
| `UPSTREAM_TIMEOUT_MS` | `30000` | Upstream timeout |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `30` | Per-IP rate limiting to protect your quota |

### API

#### `POST /api/download`  *(also available as `GET /api/download?url=…`)*

Request:
```json
{ "url": "check this out https://www.tiktok.com/@tiktok/video/7106594312292453675?_r=1&_t=abc" }
```
The server extracts the TikTok link, strips all tracking parameters, forwards it to RapidAPI and normalises the response.

Success — `200`:
```json
{
  "success": true,
  "video": {
    "sourceUrl": "https://www.tiktok.com/@tiktok/video/7106594312292453675",
    "videoId": "7106594312292453675",
    "title": "caption text…",
    "coverUrl": "https://…",
    "durationSeconds": 14,
    "sizeBytes": 2500000,
    "authorUsername": "tiktok",
    "authorNickname": "TikTok",
    "musicTitle": "original sound",
    "downloadUrl": "https://….mp4",
    "quality": "HD",
    "hdAvailable": true,
    "watermarkUrl": null
  }
}
```
`downloadUrl` is the direct **watermark-free** MP4 (HD preferred, SD fallback).

Errors — stable JSON for the app to render:
```json
{ "success": false, "error": { "code": "INVALID_URL", "message": "…" } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_URL` | Not a valid TikTok video link |
| 422 | `VIDEO_UNAVAILABLE` | Private / deleted / region-locked video |
| 429 | `RATE_LIMITED` | Our limiter or the RapidAPI quota fired |
| 502 | `UPSTREAM_AUTH` / `UPSTREAM_ERROR` / `NO_MEDIA_LINK` | Scraper rejected the key, errored, or returned no MP4 (e.g. slideshow posts) |
| 504 | `UPSTREAM_TIMEOUT` | Scraper too slow |

Smoke test:
```bash
curl http://localhost:3000/healthz
curl -X POST http://localhost:3000/api/download \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.tiktok.com/@tiktok/video/7106594312292453675"}'
```

---

## Phase 3 — Frontend (Flutter)

### 1. Scaffold platform folders
The repo ships the complete Dart code + `pubspec.yaml`; generate the `android/` and `ios/` platform shells inside `frontend/`:

```bash
cd frontend
flutter create . --platforms android,ios --org com.yourcompany --project-name tikgrab
flutter pub get
```
(`flutter create .` only adds missing files — it keeps the provided `lib/`, `pubspec.yaml` and config files intact.)

### 2. Point the app at the backend

| Target | Command |
|---|---|
| Android emulator | `flutter run` *(default `http://10.0.2.2:3000`)* |
| iOS simulator | `flutter run --dart-define=BACKEND_URL=http://localhost:3000` |
| Physical device | `flutter run --dart-define=BACKEND_URL=http://<dev-machine-LAN-IP>:3000` |
| Production build | `flutter build appbundle --dart-define=BACKEND_URL=https://api.your-domain.com` |

### 3. Android share-sheet setup

Replace `android/app/src/main/AndroidManifest.xml` with
**[`frontend/native_setup/android/AndroidManifest.xml`](frontend/native_setup/android/AndroidManifest.xml)**. Highlights:

- `ACTION_SEND` + `text/plain` intent-filter on `MainActivity` → TikGrab appears in TikTok's share sheet.
- `android:launchMode="singleTask"` → incoming intents reuse the activity.
- `INTERNET` permission; **no storage permission needed on Android 10+** (`gallery_saver_plus` writes through MediaStore). `WRITE_EXTERNAL_STORAGE` is declared only for Android ≤ 9 and requested at runtime by `permission_handler`.
- `usesCleartextTraffic="true"` is for local `http://` development only — remove it once the backend is HTTPS.

That's it for Android — run the app, share from TikTok, watch it download.

### 4. iOS share-sheet setup

iOS requires a small **Share Extension** target (system requirement — paste-ready files are in [`frontend/native_setup/ios/`](frontend/native_setup/ios/)):

1. **Create the extension**: Xcode → open `ios/Runner.xcworkspace` → File → New → Target → **Share Extension** (e.g. name it `Share Extension`). Match Runner's minimum deployment target.
2. **Enable Swift Package Manager** once: `flutter config --enable-swift-package-manager`, then regenerate `ios/` if needed. Link the **`receive-sharing-intent`** library to the *Share Extension* target (target → General → Frameworks and Libraries → **+**).
3. **Replace** `ios/Share Extension/ShareViewController.swift` with [`native_setup/ios/ShareViewController.swift`](frontend/native_setup/ios/ShareViewController.swift) (subclasses the plugin's `RSIShareViewController`, auto-redirects into TikGrab).
4. **Replace** `ios/Share Extension/Info.plist` with [`native_setup/ios/share_extension_Info.plist`](frontend/native_setup/ios/share_extension_Info.plist) (activation rule = text + 1 web URL).
5. **Main app `ios/Runner/Info.plist`** — add:
   ```xml
   <key>AppGroupId</key>
   <string>$(CUSTOM_GROUP_ID)</string>

   <!-- wakes TikGrab after the extension stashes the shared link -->
   <key>CFBundleURLTypes</key>
   <array>
     <dict>
       <key>CFBundleTypeRole</key><string>Editor</string>
       <key>CFBundleURLSchemes</key>
       <array><string>ShareMedia-$(PRODUCT_BUNDLE_IDENTIFIER)</string></array>
     </dict>
   </array>

   <!-- gallery saving -->
   <key>NSPhotoLibraryUsageDescription</key>
   <string>TikGrab saves downloaded videos to your Photos library.</string>
   <key>NSPhotoLibraryAddUsageDescription</key>
   <string>TikGrab saves downloaded videos to your Photos library.</string>
   ```
   Also allow local HTTP while developing:
   ```xml
   <key>NSAppTransportSecurity</key>
   <dict><key>NSAllowsLocalNetworking</key><true/></dict>
   ```
6. **App Groups**: Signing & Capabilities → add *App Groups* to **both** targets with the same container (e.g. `group.com.yourcompany.tikgrab`). Add a user-defined build setting **`CUSTOM_GROUP_ID`** = that container id to **both** targets.
7. Runner → Build Phases → move **“Embed Foundation Extension” above “Thin Binary”**.

### 5. How the code is wired

| Layer | File | Responsibility |
|---|---|---|
| Entry / theme / routing | `main.dart`, `app.dart` | Material app, dark TikTok theme, single route |
| Share intents | `services/share_handler.dart` | Cold + warm start intents → cleaned URL → auto-download |
| Link hygiene | `core/tiktok_url_parser.dart` | Extract link from shared text, force https, drop tracking params |
| Backend client | `services/api_service.dart` | `POST /api/download`, maps HTTP codes to friendly messages |
| Downloader | `services/download_service.dart` | dio stream → temp MP4 with 0–100% progress → gallery import |
| UI | `screens/home_screen.dart` | Paste field, download button, video card, progress bar, states |

---

## Security notes

- The RapidAPI key lives **only** in `backend/.env` (git-ignored). The Flutter app never sees it.
- The backend validates hosts (`*.tiktok.com` only), strips query strings, caps body size (16 KB), rate-limits per IP, and never echoes the upstream payload back raw.
- 🔑 **Rotate the key you pasted into chat** (RapidAPI → your subscription → credentials) and update `backend/.env` — treat anything shared in plain text as compromised.

## Production checklist

- [ ] Deploy the backend behind **HTTPS** (Render/Railway/Fly/Docker all work — it's a plain Express app) and set `ALLOWED_ORIGINS` to your real origins.
- [ ] Remove `usesCleartextTraffic` (Android) and the ATS exception (iOS).
- [ ] Uncomment `app.set('trust proxy', 1)` in `server.js` when behind a reverse proxy.
- [ ] Consider a CDN/proxy endpoint if the scraper CDN links expire or hotlink-block in your region.
- [ ] Slideshow/photo posts return `NO_MEDIA_LINK` by design — only videos are downloadable.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not reach the backend` | Backend not running, or wrong `BACKEND_URL` (physical devices need your LAN IP, not `localhost`). |
| App doesn't appear in Android share sheet | Missing `ACTION_SEND` intent-filter, or `mimeType` isn't `text/plain`; uninstall/reinstall so Android re-reads the manifest. |
| App doesn't appear in iOS share sheet | Share Extension target missing, wrong `NSExtensionPointIdentifier`, or scroll right → "More" in the share sheet to enable it. |
| iOS share opens app but no link arrives | App Group / `CUSTOM_GROUP_ID` mismatch between targets, or missing `ShareMedia-…` URL scheme in Runner's Info.plist. |
| 429 from backend | You hit the per-IP limiter or the RapidAPI plan quota. |
| Video not in gallery (Android ≤ 9) | Grant the storage permission prompt and retry. |
