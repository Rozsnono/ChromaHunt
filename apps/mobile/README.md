# ChromaHunt mobile (Android)

Expo SDK 58 / React Native 0.88, TypeScript (strict), Expo Router, NativeWind (Tailwind), lucide icons, Reanimated animations. Android only for the first release.

> **Expo Go is not enough.** Camera permissions flow, push notifications and biometric prompts need an Expo **development build** (EAS Build). Everything else can be exercised in a dev build too, so use one from the start.

## Setup

```bash
pnpm install                                   # from the repository root
cp apps/mobile/.env.example apps/mobile/.env   # EXPO_PUBLIC_API_URL (+ GOOGLE_SERVICES_JSON)
```

- Backend URL: `EXPO_PUBLIC_API_URL`. Android emulator → host machine is `http://10.0.2.2:3000`; production must be HTTPS.
- Push notifications (Android) need a Firebase project: download `google-services.json`, keep it out of git and point `GOOGLE_SERVICES_JSON` to it (use an EAS file secret for cloud builds). Then run `eas init` so the project id exists (`extra.eas.projectId`); without it push registration is skipped silently.

## Run

```bash
pnpm --filter @chromahunt/mobile start        # Metro for a dev client
eas build --profile development --platform android   # development build (APK)
eas build --profile production --platform android    # signed AAB for the Play Store
```

Quality gates: `pnpm --filter @chromahunt/mobile typecheck`, `lint`, `test`, and `pnpm --filter @chromahunt/mobile bundle` (compiles the Android bundle with Metro).

## Structure

```
src/app            Expo Router screens: (auth) login/register, (gate) forced password change / privacy,
                   (tabs) Today · Calendar · Ranking · Groups, group/[id], group/new, join, camera, photo/[id], profile
src/components     UI kit (NativeWind), camera/queue/push runners, biometric offer
src/lib            api-core (envelope, single-flight token refresh), session, biometric, upload-queue (SQLite),
                   queue-rules, color-precheck, push, calendar, i18n helpers
src/i18n           hu (default) / en dictionaries, completeness enforced by tests
```

## Behaviour worth knowing

- **Camera only.** No gallery picker exists; the gallery/storage permissions are blocked in `app.config.ts`. There is no live colour hint: grabbing preview frames made Android flash the screen, so the colour pre-check runs only after a real capture.
- **Photo pipeline:** capture → resize to 1080 px on the long edge → JPEG re-encode (drops EXIF/GPS) → client pre-check (blocks only photos more than 15 points below the server threshold) → persistent queue.
- **Offline queue:** SQLite + files in the app document directory. Backoff 5 s → 15 min (±20 %), `Retry-After` respected, discarded after the deadline (the user is told on the Today tab). Drained on start, foreground, connectivity change, every 30 s and by an OS background task (~15 min, best effort).
- **Sessions:** access token auto-refresh with one shared refresh call; offline at start keeps the session; a rejected refresh signs out. Logout and account deletion wipe the queue and the biometric secret.
- **Biometrics:** a random per-device secret in the Keystore (`requireAuthentication`), offered once per device after a password login; the password is always the fallback.

## Device test checklist (needs a real Android device)

- [ ] Camera permission flow, capture, too-far block, accepted/rejected result.
- [ ] Airplane mode: capture offline, restore the network, photo uploads and the result appears.
- [ ] Biometric enrollment, unlock after restart, disabled after password change.
- [ ] Push: daily color, deadline reminder, photo result; tapping opens the right screen.
- [ ] Join by QR code and by `chromahunt://join?code=…` deep link.
- [ ] Dark mode, Hungarian/English, TalkBack labels, font scaling.
