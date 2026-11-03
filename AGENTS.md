# AGENTS.md – ChromaHunt

Ez a fájl a projekt egyetlen "igazságforrása" emberi fejlesztők és AI-asszisztensek számára. **Minden érdemi változtatásnál frissíteni kell.** (Nincs GEMINI.md; ha létrejön, annak csak arra kell utalnia, hogy a projektinformációk itt találhatók.)

## Projekt típusa

**Külső projekt – NEM KEDD-alkalmazás.** Saját felhasználókezelés (MongoDB), nincs Windows/AD és nincs KEDD-Intranet integráció. Ha a projekt később KEDD-alkalmazássá válik, felül kell vizsgálni az auth-ot (AD), a központi konfigot (KEDD-Intranet API) és a Windows-kompatibilitást.

## Cél

Privát csoportos színvadász-kihívás platform: a csoportok naponta egy véletlenszerű színt kapnak, a tagok **csak élő kamerával** fotóznak olyan tárgyat, amelyben a szín dominál; a szerver kétlépcsős színellenőrzéssel dönt az elfogadásról; opcionális heti pontverseny, push értesítések, naptáras galéria, admin webfelület.

**Jelenlegi állapot:** a **backend és az admin webfelület kész** (`apps/web`). A **mobilalkalmazás kódja elkészült** (`apps/mobile`, Expo SDK 58, csak Android): auth + biometria, csoportok/meghívó/QR, Ma képernyő, élő kamera (élő színjelző nélkül: az előnézeti képkockák mintavételezése Androidon villogást okozott, ezért az előellenőrzés csak a felvétel után fut), offline feltöltési sor, naptár, rangsor, push, profil. **Eszközön/emulátoron még nem futtattam** (csak typecheck, lint, egységtesztek és Metro Android bundle igazolja), a kamerát/pusht/biometriát valódi eszközön kell kipróbálni (lásd `apps/mobile/README.md`). A fájltároló bekötése (lásd Külső rendszerek) még függőben.

## Felépítés (pnpm monorepo)

```
apps/web            Next.js 16 (App Router): REST API + admin felület
  src/app/api/**      route handlerek (validate → authorize → execute → respond)
  src/app/admin/**    admin UI (Tailwind, lucide-react, framer-motion; hu/en)
  src/server/**       szerveroldali logika (env, db, auth, modellek, szolgáltatások, tároló)
  src/lib/**          kliensoldali segédek (api kliens, i18n, useApi)
  src/proxy.ts        biztonsági fejlécek + CORS (Next 16 „proxy", régi „middleware")
  tests/**            integrációs tesztek (vitest + in-memory MongoDB replica set)
  scripts/**          dev-db.mjs (helyi MongoDB), seed-demo.mjs (demó adatok)
apps/mobile         Expo (React Native) Android app: NativeWind (Tailwind), lucide-react-native, Reanimated
  src/app             Expo Router képernyők ((auth), (gate), (tabs), group/[id], camera, join, photo/[id], profile)
  src/lib             api-core (boríték, single-flight refresh), session, biometric, upload-queue (SQLite), queue-rules, color-precheck, push
packages/shared     Zod sémák, konstansok, színmatek (ΔE2000, k-means), időzóna/ISO-hét, pontozás
docs/               architecture.md, security.md, api.md
```

## Technológiai stack

Mobil: Expo SDK 58 / React Native 0.88, Expo Router, NativeWind 4 (Tailwind 3), react-native-reanimated, expo-camera, expo-sqlite, expo-secure-store, expo-local-authentication, expo-notifications, expo-background-task. Backend/admin: TypeScript (strict), Next.js 16 + React 19, Tailwind CSS 4, lucide-react, framer-motion, MongoDB + Mongoose 9, Zod 4, jose (JWT), @node-rs/argon2 (argon2id), sharp (képfeldolgozás), WebDAV (fetch alapú saját kliens), Expo Push API, vitest + mongodb-memory-server. **Bootstrap (CSS) nem használható** – csak Tailwind.

## Indítás, build, teszt

```bash
pnpm install                       # (pnpm 12; ha nincs: corepack enable pnpm)
pnpm --filter @chromahunt/web exec node scripts/dev-db.mjs   # helyi MongoDB replica set (27018)
cp apps/web/.env.example apps/web/.env.local                 # értékek kitöltése, STORAGE_DRIVER=fs fejlesztéshez
pnpm dev                           # http://localhost:3000  (admin: /admin)
node apps/web/scripts/seed-demo.mjs http://localhost:3000    # demó adatok (csak dev)
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Konfiguráció (környezeti változók – `apps/web/.env.example`)

Minden érték környezetből jön, a kódban nincs beégetett érték. `src/server/env.ts` Zod-dal validál, hiba esetén olvasható üzenettel elbukik (lusta betöltés, ezért `next build` secret nélkül is lefut). Titkok: `JWT_ACCESS_SECRET`, `UPLOAD_TOKEN_SECRET`, `ADMIN_SESSION_SECRET`, `TOKEN_PEPPER` (HMAC kulcs refresh tokenhez, meghívókódhoz, biometrikus titokhoz – cseréje érvényteleníti azokat), `CRON_SECRET`, `ADMIN_PASSWORD`, `MONGODB_URI`, WebDAV hitelesítő adatok. **Titok soha nem kerülhet gitbe** (`.env*` a `.gitignore`-ban; csak `.env.example` kommitálható). Ha titok mégis bekerült: az érintett credentialt azonnal vissza kell vonni/rotálni és a Git historyból el kell távolítani.

## Külső rendszerek / API-k

- **MongoDB** (Atlas vagy replica set; a fióktörlés tranzakciót használ).
- **Fájltároló:** a tulajdonos által megadott `https://api.filesharer.rozsnorbert.hu:9443` NEM sima WebDAV, hanem saját „Synology WebDAV Chunked Uploader API" (`x-api-key` fejléc; `POST /upload/start|chunk|finish|failed`, `GET /upload/status/:id`, `GET /download?path=`, `/download/info`, `/download/list`, `GET /health`). **Nincs benne törlés végpont**, ezért az elutasított fotó azonnali törlése, a megőrzési takarítás és a fióktörlés vele nem teljesíthető. A `DELETE /files?path=` végpont **elkészült** a feltöltőben (v1.1.0 spec ellenőrizve; elérési utak a kulcs mappájához képest relatívak; `docs/filesharer-delete-spec.md`). A backend `FileSharerStorage` drivere (`STORAGE_DRIVER=filesharer`, `FILESHARER_URL/_API_KEY/_BASE_PATH` (opcionális relatív alkönyvtár)) kész és fake szerverrel tesztelt (egy chunkos feltöltés, lapos fájlnevek `groups__g__a__s.jpg`), de **éles szerveren egy tesztfájllal kipróbálva (feltöltés, azonos bájtok letöltése, törlés, 404, ismételt törlés – 2026-11-03)**; az API-kulcs nincs a repóban (csak a gitből kizárt `.env.local`-ban), csak a szerver környezetében lehet. A régi `WebDavStorage` (sima WebDAV) megmaradt alternatívaként.
- **Expo Push** (`exp.host/--/api/v2/push`): értesítés + receipt-ek (`DeviceNotRegistered` → token törlése). Androidon FCM (`google-services.json`) szükséges az appban – még nincs beállítva.
- **Külső ütemező** (GitHub Action nem használunk – tulajdonosi döntés): valamilyen külső szolgáltatásnak (pl. Render cron, cron-job.org) 5 percenként kell hívnia a `GET /api/cron/tick` végpontot `Authorization: Bearer $CRON_SECRET` fejléccel. Vercel Hobby cron csak napi 1×, ezért ez kötelező a csoportonkénti sorsoláshoz. **Az ütemező kiválasztása és beállítása még hátravan.**

## Adat- és fájlformátumok

- API válaszboríték: `{success, data, error:{code,message:"error.<CODE>",details}|null, meta:{requestId}}`.
- Fotó: kliens oldalon max 1080 px JPEG; szerveren újrakódolva (EXIF nélkül, orientáció alkalmazva, max 1080 px, q80), tároló kulcs: `groups/<groupId>/<assignmentId>/<submissionId>.jpg`.
- Dátumok: `DailyAssignment.date` = helyi `YYYY-MM-DD` a csoport időzónájában; hét = ISO hétkulcs `YYYY-Www`.
- Mongoose modellek: `apps/web/src/server/models/*` (minden séma `timestamps: true`).

## Fontos üzleti szabályok (összefoglaló)

- Regisztráció e-mail + jelszó (min. 10 karakter), kötelező adatvédelmi elfogadás (verzió: `PRIVACY_POLICY_VERSION`), azonnali belépés. Nincs önkiszolgáló jelszó-visszaállítás: csak admin állíthat be ideiglenes jelszót → kötelező csere (`mustChangePassword`).
- Access token 15 perc, refresh token 30 nap, **minden használatkor rotál**, újrafelhasználás-észlelés (a teljes `familyId` visszavonva). Jelszócsere/reset/letiltás minden munkamenetet és biometrikus kötést visszavon.
- Biometria: eszközhöz kötött véletlen titok (SecureStore), a szerver csak HMAC-jét tárolja (`BiometricBinding`). Jelszó mindig tartalék.
- Csoport: bárki létrehozhat (admin lesz), **egy csoportadmin**, zárt csoport. **Csak a csoportadmin** generál meghívót (8 karakteres Crockford base32 kód + QR payload, 24 óra, egyszer használatos, atomikus `findOneAndUpdate`); csatlakozás csak admin jóváhagyással. Admin kilépésekor a legrégebbi tag lesz admin, üres csoport archiválódik. Csoportot törölni nem lehet, csak archiválni (admin).
- Napi sorsolás: aktív palettából véletlenszerűen, cooldown (alap 3 nap); ha minden szín cooldownon van, a legrégebben használtat engedi (`draw.palette_cooldown_relaxed` audit); üres paletta → kihagyás + riasztás (`draw.palette_empty`). Egyedi index (groupId, date). Új csoport azonnal kap színt (a határidő sosem lépi túl a következő sorsolást: legfeljebb 24 óra).
- Feltöltés: `intent` (idempotency key, egyszer használatos, 10 perces feltöltési token) → `PUT /api/uploads/:id` (token az `X-Upload-Token` fejlécben + bearer) → `finalize` (hiteles szerveroldali ellenőrzés). A kliens pontszáma nem megbízható. Határidő: szerver fogadási idő.
- Színellenőrzés: 64×64 középre vágott (cover) kép, **középre súlyozott** (σ=0,2) k-means (k=4, 20 iteráció, fix seed) CIELAB-ban; kromatikus célszínnél a L<10 / L>95 pixelek kizárva; closeness = clamp(100·(1−(ΔE2000−5)/35),0,100); elfogadás ≥ csoport küszöb (alap 55, globális minimum érvényesül). Elutasított fotó azonnal törlődik a tárolóból. **Nincs dominancia-szorzó** (nyitott termékdöntés).
- Pontozás (csoportonként kapcsolható): napi pont = round(teljesítési arány × átlagos closeness − hiányzó fotók × büntetés), alsó korlát `minDailyPoints`; a határidő után számol, csak a határidő előtt csatlakozott tagokra. Heti zárás az ISO hét végén (csoport időzónája); holtverseny: több pont → gyorsabb átlagos teljesítési idő → userId.
- Megőrzés csoportonként (`retentionDays`), óránkénti takarítás; hiba esetén `cleanup_pending`, 5. hibánál riasztás. Kilépő/eltávolított tag fotói és pontjai az adott csoportból törlődnek.
- Fióktörlés azonnali és végleges: tranzakció + tároló-outbox (`StorageDeletionTask`), admin-átadás, audit anonimizálás (`deleted-user`).
- Admin: egyetlen `ADMIN_PASSWORD` env jelszó → szuperadmin session (HttpOnly, SameSite=Strict cookie; rate limit + IP-zárolás, IP csak hashelve). **Nincs DB-ben admin user és nincs bootstrap.** A felhasználók dinamikus `permissions[]` stringjei (`palette.manage`, `users.manage`, `groups.manage`, `storage.manage`, `settings.manage`, `permissions.manage`, `audit.view`) az admin **API**-ra vonatkoznak bearer tokennel; a webes panelbe csak az admin jelszóval lehet belépni. Minden admin művelet az `AuditLog`-ba kerül.

## Ismert korlátok / elfogadott kockázatok

1. A kliensoldali színellenőrzés (mobil) csak UX; a szerver a mérvadó.
2. A feltöltés a backenden keresztül proxyzik (WebDAV-nak nincs presigned URL-je): nagyobb szerver-sávszélesség. Vercel kérés-limit ~4,5 MB → `MAX_UPLOAD_BYTES` = 4 MB.
3. A kamera-only szabály módosított klienssel megkerülhető; képernyőn mutatott szín átmehet. Nincs automatikus arc/személy szűrés (csak manuális eltávolítás).
4. Nincs mentés a szolgáltatói alapértelmezésen túl – ajánlott: Atlas continuous backup + WebDAV snapshot (üzemeltetési feladat).
5. Egyidejű dupla refresh (két párhuzamos kérés ugyanazzal a tokennel) újrafelhasználásnak minősül és kijelentkeztet.
6. Mongo-alapú fix ablakos rate limit (nem csúszó ablak).
7. `closeFinishedWeeks` csak az elmúlt ~5 hét heteit zárja; régebbiek élő aggregációval is helyesen olvashatók.
8. Az e-mail nincs megerősítve (csak azonosító; nincs e-mail küldés).

## Tesztelés

`pnpm test`: shared (színmatek, idő, pontozás) + web integrációs tesztek valódi route handlerekkel, in-memory MongoDB replica seten és memória-tárolóval: auth/refresh-reuse, meghívó atomicitás (párhuzamos beváltás), sorsolás egyediség/cooldown, feltöltési folyam (EXIF, token újrajátszás, határidő, 503), retention, fióktörlés kaszkád, pontozás/rangsor, **jogosultsági mátrix** (minden admin route minden permissionre), CSRF, CORS/fejlécek. Hibajavításhoz regressziós tesztet kell írni.

## Kompatibilitási követelmények

Node ≥ 20 (fejlesztés: 24), pnpm workspace. Mobil: **csak Android**, Expo development build (EAS) szükséges kamerához/push/biometriához – Expo Go nem elég. Meglévő működés megőrzése elsődleges; breaking change esetén migráció vagy egyértelmű figyelmeztetés kell. Új dependency csak indokolt esetben.

## Kódminőség

A kód legyen emberi fejlesztő és más AI számára is érthető: angol azonosítók és kommentek (a „miért" kerüljön kommentbe), szigorú TypeScript (`any` tilos), route handler = validate → authorize → execute → respond, tiszta logika külön, tesztelhető függvényekben. Hibakezelés: a felhasználó érthető (i18n kulcsú) hibakódot kap, a technikai részlet a logba kerül titok és személyes adat nélkül (`src/server/logger.ts` redaktál); nincs néma hiba.

## Nyitott döntések (termék)

Dominancia-szorzó a closeness-ben; adatvédelmi szöveg és életkori korlát (jogi felülvizsgálat); **a deployment környezetébe a `FILESHARER_*` változók beállítása** (a kulcs mappához kötött: `ChromaHunt`); Firebase/FCM projekt a push-hoz; Android csomagnév (jelenleg `hu.chromahunt.app`, placeholder) és EAS-projekt.
