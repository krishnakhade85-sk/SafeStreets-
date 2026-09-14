# SafeStreets Mumbai 💜

SafeStreets is a women-led community safety and route guidance platform for Mumbai. It helps women make informed, confident travel decisions by sharing anonymous, time-specific experiences of roads, transit stations, skywalks, and neighbourhoods.

> **Tagline:** *"Know the road before you take it."*  
> **Core Principle:** *"Place + time matter. Anonymous by default. Practical guidance from the community."*

---

## 🎨 Purple Textured Aesthetic & Modern Design System

The frontend has been revamped with a **velvet amethyst & purple texture theme**:
- **Procedural Purple Texture**: Ambient radial mesh layers with tactile micro-grain texture.
- **Glassmorphic Cards**: Translucent obsidian/purple quartz surfaces with frosted blurs (`backdrop-filter: blur(20px)` and `-webkit-backdrop-filter: blur(20px)`), subtle neon violet border glows, and crisp specular highlights.
- **Calibrated Signal Colors**: Emerald mint (Comfortable), glowing amber (Caution), and rose crimson (Avoid) calibrated for high contrast and accessibility on dark purple canvases.

---

## 📱 Perfect Android App (Native & PWA)

SafeStreets Mumbai is packaged both as a **Progressive Web App (PWA)** and a **Native Android Jetpack Compose** application:

1. **Floating Mobile Bottom Navigation Bar**:
   - Integrated ergonomic bottom bar with 5 tactile tabs: `Home`, `Explore Map`, `Plan Route`, `Share Review`, and `SOS 103`.
   - Active state neon violet pill glows with tactile touch feedback.
2. **PWA Standalone Support**:
   - Complete `manifest.json` configured for `standalone` display, `window-controls-overlay`, shortcuts, and maskable icons.
   - Smart in-app install banner with auto-detection on Android devices.
   - Offline resilience service worker (`sw.js`) caching core maps, emergency contacts, and pages.
3. **Native Android App (`android/`)**:
   - Modern Kotlin Jetpack Compose wrapper with `WebView`.
   - `WebChromeClient` with automatic Geolocation permissions (`onGeolocationPermissionsShowPrompt`) so "Use Current Location" functions seamlessly inside the Android APK.
   - File chooser integration (`onShowFileChooser`) allowing road photo uploads.
   - Dynamic cloud server configuration with custom endpoint setup and fallback.

---

## 🧭 Apple iOS Safari Optimization

Optimized for mobile Safari and WebKit:
- **Dynamic Viewport Units**: Uses `100dvh` to prevent vertical layout shifts when Safari's mobile URL bar expands and collapses.
- **Safe Area Insets**: Full support for `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` for iPhone notches, Dynamic Island, and home indicators.
- **Anti-Zoom Form Inputs**: All inputs and selects enforce a minimum `font-size: 16px` to eliminate iOS Safari automatic page zoom on focus.
- **Apple Web App Tags**: Configured with `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, and `apple-touch-icon`.
- **Safari Vibration & Touch Safe**: Feature-detected Web APIs preventing unhandled errors on iOS.

---

## ☁️ Cloud-First Architecture (Decoupled from Localhost:3000)

- **Cloud-Ready API Client**: `api.js` dynamically resolves its endpoint based on `window.SAFE_STREETS_CONFIG.API_BASE`, `localStorage.getItem('safestreets_cloud_api')`, or the current cloud origin (`0.0.0.0` host binding).
- **Containerization**: Includes a production `Dockerfile` for deployment to **Google Cloud Run**, **Render**, **Railway**, or **Fly.io**.
- **1-Click Render Config**: `render.yaml` preconfigured for free cloud deployment.

---

## 🚀 Running Locally

SafeStreets Mumbai is built with native Node.js v24 modules (`node:http`, `node:sqlite`, `node:crypto`) — requiring **zero external npm runtime dependencies**.

### Start the Server:
```bash
node server/server.js
```

### Run Automated Tests:
```bash
node --test test/suite.test.js
```

### Moderator Credentials:
- **Username:** `moderator`
- **Password:** `safestreets2026`

---

## 📦 Pushing to GitHub

Repository URL: `https://github.com/krishnakhade85-sk/SafeStreets-`

```powershell
# 1. Initialize git and stage all files
git init
git add .

# 2. Commit
git commit -m "feat: Android & Safari PWA, purple textured theme, cloud-first deployment"

# 3. Rename branch to main
git branch -M main

# 4. Set remote repository
git remote add origin https://github.com/krishnakhade85-sk/SafeStreets-.git

# 5. Push to GitHub
git push -u origin main
```
