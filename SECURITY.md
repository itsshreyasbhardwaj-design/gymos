# Security

Written against the implementation. Where something is not done, it says so.

## Authentication

| Control | Implementation |
| --- | --- |
| Password hashing | scrypt, `N=2^15, r=8, p=1`, 64-byte key, per-password 16-byte salt. Parameters are stored with the hash so the cost can be raised later without invalidating existing passwords. |
| Verification | `timingSafeEqual`. An unknown account still performs a scrypt verification against a dummy hash so response timing does not reveal account existence. |
| Password rules | Minimum 10 characters, maximum 200, rejects common patterns (`password`, `qwertyuiop`, `gymos`, …) and single repeated characters. |
| Session tokens | 32 random bytes, base64url. Only a **SHA-256 hash** is stored, so the database never holds a usable token. |
| Cookies | `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`, 14-day max age. |
| Expiry and revocation | Server-side `expires_at` and `revoked_at`. Changing a password revokes every other session. Users can revoke all other sessions from Settings → Security. |
| Rate limiting | Database-backed sliding window: 20 failed logins per IP / 15 min, 8 per account / 15 min, 5 signups per IP / hour. Failures are identical whether the account exists or the password is wrong. |
| Session metadata | Truncated user-agent and a **salted hash** of the IP. Raw IPs are never stored. |

## Authorization

Ownership is enforced **in the SQL predicate**, not by filtering after a fetch:

```ts
db.select().from(workoutSessions)
  .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)))
  .get();
```

Every service function that accepts an id also accepts the acting `userId`. Rows reached
through a join (planned exercises, planned meals, grocery items) are checked by joining
back to the owning table.

`tests/integration/authorization.test.ts` drives **every** such function with a second
account's ids — 23 assertions covering equipment, plans, sessions, logs, RealitySync,
nutrition, groceries, pantry, progress and FitBrain — and verifies the victim's records
are unchanged afterwards.

The admin area checks `requireAdmin()` in both the layout and the page, because a layout
is not an authorization boundary on its own.

## Request forgery

- **Server Actions** carry Next.js's own Origin/Host verification.
- **Route handlers** (`/api/fitbrain`, `/api/preview/plan`) call `assertSameOrigin()`
  and `requireJson()` explicitly, because route handlers do not get that for free.
- **The media handler** (`/api/media`) calls `assertSameOriginStrict()` instead. The JSON
  content-type gate does not protect it: `multipart/form-data` is a CORS-simple type, so
  a cross-site HTML form can post one without a preflight. The strict variant refuses a
  request that cannot positively prove same origin, rather than treating a missing
  `Origin` header as benign.
- `SameSite=Lax` cookies cover the cross-site form-post case.

## Entitlements

Checked on the server on every gated write path via `requireEntitlement()`, which throws
`EntitlementError`. Hiding a button is a UI nicety; the limit is the server check.
Verified in `tests/integration/workflow.test.ts` by calling the services directly with a
`free` plan.

## Input validation

- Zod schemas on both JSON route handlers.
- Service-layer validation for email format, password strength, session length, training
  days, quantities and clamped numeric ranges.
- Every user-supplied string is length-capped before it is stored.
- All database access goes through Drizzle's parameterised queries. There is no string
  interpolation into SQL anywhere in the codebase.

## Sensitive data

| Practice | Status |
| --- | --- |
| Data minimisation | No height, weight or body measurements are collected during onboarding; none are needed to plan training. |
| Biometrics | Consent-gated at the **service** layer, refused outright for under-18 accounts, and deletable in one action that removes every row. |
| Audit events | Recorded for signup, login, password change, session revocation, export, account deletion and onboarding completion, with a hashed IP. |
| Safe logging | No request bodies, passwords, tokens or personal data are logged. The client error boundary logs only `error.message`. |
| Third-party scripts | None. The application makes no external network calls at runtime. |
| Export | Full JSON export excludes the password hash, and is scoped to the requesting user. It also excludes `ivHex`, `authTagHex` and `storagePath`, which would weaken the encrypted media files if exported. |
| Deletion | Hard delete across every table, including rows reachable only through a join, and the encrypted media files on disk. Verified by an orphan check in `tests/integration/privacy.test.ts`. |
| Private media | Encrypted at rest, metadata stripped before encryption, served only through an authenticated ownership-checked handler, never given a public URL. See the section below. |

## Private media

Photographs and voice recordings are the most sensitive thing GymOS holds, so this is
set out in full. [WELLNESS.md](WELLNESS.md) covers the product side; this is the
mechanics.

| Control | Implementation |
| --- | --- |
| Encryption at rest | AES-256-GCM, fresh 96-bit IV per file, auth tag stored beside the row. `lib/media/crypto.ts` |
| Key | `GYMOS_MEDIA_KEY` via scrypt, or — with none set — a random per-install key at `data/media/.media-key`, mode `0600`. `isDevelopmentKey()` reports which, and the privacy screen, FitBrain and the data export all say so. The app never implies managed key handling it does not have. |
| Not in the served tree | Files live under `GYMOS_MEDIA_PATH` (default `data/media`), written `0600`, outside `public/`. There is no static path to any of them. |
| Single read path | `GET /api/media/[id]` authenticates, then checks the owner **or** an explicit unexpired unrevoked grant, in the SQL predicate, before decrypting a byte. |
| Indistinguishable refusals | "Not yours" and "does not exist" return byte-identical messages and a 404, so probing ids reveals nothing about what exists. |
| Metadata stripping | Real parsing, no dependencies, run **before** encryption so the plaintext on disk never held it. JPEG: every `APPn` (EXIF/XMP/IPTC) and `COM` segment. PNG: structural-chunk allowlist. WebP: `EXIF`/`XMP ` chunks with the RIFF size rewritten. MP3: ID3v2 and ID3v1. `lib/media/strip-metadata.ts` |
| Honest stripping flag | `metadata_stripped` means the file went through a stripper that understands its format. A WebM recording has nothing to strip and was not inspected; the privacy screen says so rather than implying a clean-up happened. |
| Tamper evidence | A file altered on disk fails its GCM auth tag and is refused with `MediaIntegrityError`. Nothing partially decrypted is ever served. |
| Age gate | Photo and voice capture are refused for under-18 accounts at the service layer (`assertMediaAgeEligible`), because there is no verified parental-consent mechanism in this build. The consent itself cannot be granted either. |
| Consent gate | Each kind of media has its own consent (`photo_journal`, `voice_recording`), checked on every write. |
| Destructive withdrawal | Turning a media consent off deletes every file collected under it, inside `setConsent`, so the toggle and the data cannot drift apart. |
| Verifiable deletion | The encrypted file is removed, the row is deleted, and a `media_deletion_events` row records the reason, bytes freed and **whether the file actually went**. The privacy screen shows that log, so "deleted" is checkable. |
| Revocable sharing | Per-file grants with optional expiry, individually revocable, plus revoke-all. Nothing is shared by default and there is no link-sharing. |
| Response hardening | `private, no-store`, `nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; sandbox`, and `Permissions-Policy` denying camera, microphone and location on the media response. |
| No secondary use | Media is never used for advertising and never for model training. There is no model and no third party in this build. |
| No biometric recognition | No face or voice identification, and no appearance scoring — the schema has no column that could hold one, and `tests/unit/journal-safety.test.ts` fails if such a column appears. |

`tests/integration/media.test.ts` drives all of this against real files: it asserts the
bytes on disk are not the photograph, that EXIF really is gone, that a second account
cannot read or delete a file, that a grant opens exactly one file and a revoke closes it,
that deletion removes the file and logs it, that consent withdrawal destroys the media,
that a tampered file is refused, and that the free-plan file allowance is enforced.

## Response headers

Set in `next.config.ts`. The media handler gets its own, stricter rule, listed first so
it wins — a config header overrides one set in a route handler.

Everything except `/api/media`:

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: camera=(self), microphone=(self), geolocation=()
```

`/api/media/*`:

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cache-Control: private, no-store, max-age=0, must-revalidate
Content-Security-Policy: default-src 'none'; sandbox
```

`microphone=(self)` is required by the voice recorder, which captures audio in the
browser. It was `()` until the voice module shipped, which silently made recording
impossible — see the bugs below. `tests/unit/headers.test.ts` asserts both rules against
the real config so neither drifts again.

## Red-team review

What was examined, and what was found:

| Area | Result |
| --- | --- |
| Broken authentication | Identical failure responses; rate limited per account and per IP; no user enumeration via timing. |
| Session handling | Only hashes stored; expiry and revocation enforced on read; password change invalidates other sessions. |
| Cross-user data leakage | **Found and fixed during development**: none remaining. Covered by a dedicated integration suite and a browser test that confirms a second account gets a 404 on another user's session URL. |
| Insecure direct object references | All id-taking functions require the acting user; tested exhaustively. |
| Export vulnerabilities | Scoped by user id; excludes the password hash. |
| File uploads | `POST /api/media` only. Strict same-origin check, authenticated, consent- and age-gated, an explicit MIME allowlist (JPEG/PNG/WebP, WebM/Ogg/MP4/MPEG/WAV), per-kind size caps, a declared-length pre-check, and an entitlement cap on file count. SVG is refused, so there is no script-bearing image path. Nothing is served from a static path. |
| Private media access | Owner or an explicit grant, in the SQL predicate. A second account gets the same 404 it would get for an id that never existed. |
| Missing validation | Zod on route handlers; service-layer validation and length caps elsewhere. |
| Entitlement bypass | Enforced server-side on every gated write; tested by calling services directly. |
| Incorrect workout filtering | 23 generator tests plus a safety suite that checks every preset × age band × experience combination. |
| Unsafe plan generation | Age bands, limitations and feedback asymmetry all tested. |
| Allergy filtering failure | Tested across every allergen, on generation, on swaps and on the grocery list. |
| Race conditions | Set logging and session completion are idempotent via unique indexes; `materialiseWeek` is idempotent. |
| Injection | Parameterised queries only; no `sql.raw` with user input. |
| Admin privilege escalation | `requireAdmin()` in layout and page; the admin area is read-only. |
| Background-job authorization | No background jobs exist. |

### Bugs found and fixed during this review

1. **Mis-ranked substitutions.** Child's pose was offered as a substitute for a lat
   pulldown because both tag `lats`. Fixed by adding a training-family guard so a
   strength exercise is never replaced by a stretch or a cardio session.
2. **Equipment counts always zero.** A correlated subquery in `listGymProfiles` returned
   0 for every profile, so the Equipment page understated every inventory. Replaced with
   a grouped query joined in memory.
3. **404 returned as 200.** A `loading.tsx` at the app-shell level flushed the response
   before `notFound()` ran, so unauthorised access to another user's session returned the
   not-found page with a 200 status. Loading boundaries were scoped to pages that never
   call `notFound()`.

### Bugs found and fixed while adding the wellness modules

4. **The microphone was disabled application-wide.** `Permissions-Policy` carried
   `microphone=()` from before any feature needed audio, which silently made the voice
   recorder impossible — `document.featurePolicy.allowsFeature('microphone')` returned
   `false` on `/voice/practice`. Found by checking the header in a real browser rather
   than trusting the component. Now `microphone=(self)` application-wide and `()` on the
   media handler, with `tests/unit/headers.test.ts` guarding both.
5. **`Referrer-Policy: no-referrer` on media responses was not actually applied.** The
   route handler set it, but a `next.config.ts` header for `/:path*` overrode it. The
   config now has a `/api/media/:path*` rule listed first, verified in the browser.
6. **"Metadata stripped" was reported unconditionally.** `stripImageMetadata` returned
   `stripped: true` for any format it understood, including files that contained no
   metadata at all, so the privacy screen could tell a user something had been removed
   when nothing had. `stripped` now means metadata was found and removed, and the
   database column records the separate fact that a stripper ran at all.
7. **Audio metadata was not stripped.** Only images were. An uploaded MP3 keeps ID3
   frames, which routinely hold a name or a comment. `stripAudioMetadata` now removes
   ID3v2 and ID3v1 tags, and honestly reports `unknown` for containers it does not parse.

## Residual risks

Stated plainly, because an application that claims to be unexploitable is lying.

1. **No independent professional review.** This build has not been penetration tested or
   audited by a security professional. That is a prerequisite before handling other
   people's health data in public.
2. **No Content-Security-Policy.** The theme script is inline (required to avoid a
   flash-of-wrong-theme before paint), so a meaningful CSP needs nonce plumbing through
   the root layout. A policy with `unsafe-inline` would provide the appearance of
   protection without the substance, so none is set. This is tracked in `ROADMAP.md`.
3. **Public preview endpoint rate limit is in-memory.** It protects a single instance and
   resets on restart. A multi-instance deployment needs a shared store.
4. **Auth rate limiting is database-backed and single-node.** Correct for this
   deployment; a distributed deployment needs a shared counter.
5. **Media encryption uses a development key by default.** With no `GYMOS_MEDIA_KEY` set,
   the key sits in a `0600` file next to the ciphertext, so anyone who can read that
   directory can decrypt it, and losing the file makes every stored file permanently
   unreadable. This is adequate for a single-user local install and nothing more. The
   app says so in the UI, in FitBrain and in the data export rather than hiding it.
6. **Voice measurements are computed in the browser and cannot be re-derived on the
   server.** Duration, pauses and speaking ratio come from real analysis of the real
   audio, but the server has no way to verify that a client sent honest numbers. They are
   a user's own record of their own practice, not an attestable measurement, and the code
   says so where it stores them.
7. **Six unreachable server actions from the original build.** Every exported
   `'use server'` function is a callable POST endpoint, so an action no UI invokes is
   reachable surface with no UI contract and therefore no end-to-end coverage. A sweep
   of all 146 exported actions found six in `app/(app)/actions.ts` that nothing
   references — `startSessionAction`, `toggleEquipmentAction`, `recordBiometricAction`,
   `markNotificationReadAction`, `setRevisionStatusAction`, `deleteGroceryListAction` —
   plus `goToStep` in onboarding. All of them call `requireUser()` and go through the
   ownership-checked services, so none is a cross-user path; they are untested surface,
   not a hole. They predate the wellness work and are listed here rather than deleted,
   because removing working code from the original build is a separate decision from
   adding these modules. `tests/unit/server-actions.test.ts` holds the list as a
   baseline that may shrink but must not grow.
8. **No virus or content scanning on uploads.** Files are type-checked, size-capped,
   re-encoded only to the extent that metadata is stripped, and served with
   `nosniff` plus a `default-src 'none'; sandbox` CSP so they cannot execute or call out.
   For a single-user local install that is proportionate; a multi-tenant deployment needs
   scanning.
5. **No email verification or password reset.** Both need an email provider, which this
   build deliberately does not configure. Account recovery is therefore impossible.
6. **No multi-factor authentication.**
7. **SQLite file permissions** are whatever the host filesystem gives them. There is no
   encryption at rest.
8. **No backups.** A production deployment needs them, with a stated retention policy.
9. **Legal review outstanding.** No assessment against GDPR, India's DPDP Act, HIPAA or
   children's-data regimes has been done. GymOS claims no compliance certification.
10. **Content review outstanding.** Exercise and recipe instructions are internal drafts.
    Presenting them as professionally reviewed would be the most consequential dishonesty
    this product could commit, which is why every surface labels them `draft`.
