# Environment

## Required configuration

**None.** GymOS runs with no environment variables and no credentials:

```bash
npm install && npm run setup && npm run dev
```

There is deliberately no `.env.example`, because an empty one would imply something is
missing. Nothing is.

## Optional variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `GYMOS_DB_PATH` | `./data/gymos.db` | SQLite file location. Used by the test and end-to-end harnesses to isolate databases. |
| `GYMOS_IP_SALT` | `gymos-local-dev-salt` | Salt for hashing IP addresses in session and audit rows. **Set this to a long random value in any shared deployment** — the default makes hashes comparable across installs. |
| `GYMOS_MEDIA_PATH` | `./data/media` | Where encrypted photographs and recordings are written. Must be **outside** any served directory. |
| `GYMOS_MEDIA_KEY` | — | Secret the AES-256-GCM media key is derived from (scrypt). With none set, GymOS generates a random per-install key and stores it at `<media path>/.media-key`, mode `0600`. That is fine for a personal local install and nothing more: the key sits beside the ciphertext, and losing the file makes every stored photo and recording permanently unreadable. The app reports which mode it is in — on the media-privacy screen, in FitBrain and in the data export — rather than implying managed key handling it does not have. **Set this to a long random secret before anyone else's media is stored.** |
| `NODE_ENV` | — | `production` marks session cookies `Secure`. |
| `PORT` | 3100 dev / 3100 start | Next.js port. |

### Rotating the media key

There is no rotation path in this build, and pretending otherwise would be worse than
saying so. Changing `GYMOS_MEDIA_KEY` makes every existing file undecryptable; GymOS
detects this as a GCM authentication failure and refuses to serve the file rather than
returning corrupt bytes. Before changing it, download what you want to keep from
Settings → Media privacy and delete the rest.

## What is deliberately NOT configured

Each of these would be a credential this build does not need:

| Provider | Status |
| --- | --- |
| OpenAI / Anthropic / Gemini | No language model is used anywhere. `lib/services/fitbrain.ts` always returns the no-op provider. |
| Supabase / Firebase | Not used. Auth and persistence are local. |
| Google / social OAuth | Not used. Email and password only. |
| Razorpay | Integration boundary only — see below. |
| Apple HealthKit / Android Health Connect | Consent record and data shape only. |
| Cloud storage (S3 etc.) | Not used. Photographs and recordings are encrypted and written to the local filesystem, and served only through an authenticated handler. Nothing leaves the install. |
| Speech recognition (Whisper, cloud ASR) | **Deliberately absent.** Nothing is transcribed, and the voice module reports only what it can genuinely measure from the audio in the browser. See [WELLNESS.md](WELLNESS.md). |
| Image recognition / vision models | Deliberately absent. No photograph is analysed, scored or classified anywhere in the app. |
| Shopping / retail APIs | Not used. The outfit engine works entirely offline from the wardrobe you record, and recommends nothing to buy. |
| Email (Resend/SES/SendGrid) | No email is sent, so there is no verification, no reset and no contact form. |
| Analytics / error tracking | None. No third-party scripts load and the app makes no external calls at runtime. |

## Integration boundaries for later

These are the exact seams where a provider would be added. Each is a real boundary in the
code, not a placeholder.

### Payments — Razorpay

- **Where:** `lib/engines/entitlements.ts` (`BILLING_STATUS`), `subscription_records`
  table, `/settings/subscription`.
- **Would need:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- **Also needs, before any charge:** webhook signature verification, idempotent
  subscription updates keyed on the provider's event id, a cancellation path that takes
  effect at period end, invoice records, and the consumer disclosures required in the
  relevant jurisdiction.
- **Current behaviour:** `BILLING_STATUS.live === false`, and every pricing surface says
  payments are not enabled. Pro is granted only via the clearly-labelled development
  switch, which records `status: 'dev_granted'` and `amount_paise: 0`.

### Language model — optional FitBrain phrasing

- **Where:** `LanguageModelProvider` in `lib/services/fitbrain.ts`.
- **Contract:** `rephrase(answer)` receives an **already-computed** answer. It cannot
  decide what the answer is, reach the planning engines, or bypass a safety rule.
- **Current behaviour:** `activeProvider()` returns `NO_LLM_PROVIDER` unconditionally.

### Health platforms

- **Where:** `biometric_records` (with `source: 'import_pending'`), `activity_records`
  (`source: 'import'`), and the `activity_import` consent kind.
- **Would need:** platform entitlements, a native shell, and a consent flow that is
  genuinely informed. Nothing in the UI claims a connection exists.

### Email

- **Where:** nothing exists yet. Adding it unlocks email verification, password reset and
  a working contact form — all of which are currently absent and said to be absent.

### Image recognition — GymScan

- **Where:** `equipment_types` supports custom entries and
  `gym_venue_equipment.review_status` supports a human approval step.
- **Contract if added:** suggest categories, display uncertainty, require the user to
  confirm, then save the confirmed selection. Never claim a photo was analysed when it
  was not.

## Local data

| Path | Contents |
| --- | --- |
| `data/gymos.db` | Development database (git-ignored) |
| `data/e2e.db` | End-to-end database, rebuilt on every run (git-ignored) |
| `drizzle/*.sql` | Committed migrations — the source of truth for schema |

`npm run db:reset` deletes and rebuilds the development database.

## Platform notes

- **Node 20+** required (built and tested on Node 24).
- `better-sqlite3` is a native module with prebuilt binaries for common platforms. The
  Next.js config lists it under `serverExternalPackages` so it is never bundled.
- Scripts and tests resolve the `server-only` marker through `tsconfig.scripts.json` and
  a Vitest alias, so the same server modules can be exercised outside a React Server
  Component graph.
