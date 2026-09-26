# Flink PWA (iNet)

Flink is a privacy-first communications **Progressive Web App**. GitHub Pages serves compiled HTML, JavaScript, CSS, and other static files directly from this repository's existing `main`-branch root publishing setup. **There is no Node.js server in production**; Node is only used locally and in CI to build the app. Authentication, groups, signaling, and optional push registration use the EML Core API at `https://emltechstudio-eml-core-api.hf.space`.

## Develop and build

```sh
npm ci
npm run dev          # local development
npm run build        # typecheck and write dist/
npm run build:pages  # build and copy the static site to the Pages root
```

The app source lives in `frontend/`, and the build writes to `dist/`. To publish an update, run `npm run build:pages` and commit/push the generated root assets (including `index.html`, `assets/`, `manifest.json`, and `sw.js`) to `main`. GitHub Pages then serves those static files using the repository's current configuration. `dist/` is ignored and does not need to be committed.

The published URL remains <https://emltechstudio-cloud.github.io/Inet/>. Assets and room routes use relative paths, so the app works under the `/Inet/` project-site path.

## Install and offline behavior

Open the Pages site over HTTPS, then use the browser's **Install app** / **Add to Home Screen** action. The app shell and static bundles are cached for offline startup; account, signaling, and calls still require a network connection. Push notifications are opt-in from **You → Enable notifications** and require browser support plus the backend's VAPID configuration.

## Returning iNet users

On first open, the PWA reads the old `inet_db` IndexedDB database and imports the local profile, contacts, direct text/image messages, and call log into the new Flink store. It never deletes the old database. The existing on-device account identifier is retained and checked against the current backend; older SIM backup files can also be restored through the saved number and password.

## What is included

- Device/password/SIM-file account recovery
- Six-digit number approach flow (ping, chat, voice, video)
- WebRTC peer sessions and temporary shareable rooms
- Groups, local conversation history, opt-in push notifications
- Responsive app shell and GitHub Pages-safe routes/assets
