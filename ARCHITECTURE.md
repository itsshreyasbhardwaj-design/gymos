# Architecture

## Shape of the system

GymOS is a single Next.js application with a strict internal layering. The rule that
matters: **domain logic never touches the database, and the database layer never makes
domain decisions.**

```
app/                 Routes, Server Components, Server Actions, route handlers
  (marketing)/       Public site
  (auth)/            Login, signup, auth actions
  onboarding/        Nine-step set-up
  (app)/             Authenticated application shell + pages
  admin/             Content review area (role-gated)
  api/               JSON route handlers (homepage preview, FitBrain, private media)
  share/             Public read-only shared grocery lists

components/          React components (server and client)

lib/
  content/           Static content catalogs (equipment, exercises, ingredients, recipes)
  engines/           Pure domain logic — no I/O, no database, fully unit-testable
  services/          Database access + authorization. The only layer that touches SQL.
  auth/              Password hashing, sessions, rate limiting, CSRF guards
  media/             Envelope encryption and metadata stripping for private files
  db/                Drizzle schema, client, seed
  ui/                Small UI helpers

drizzle/             Committed migration SQL
tests/               unit · integration · e2e
scripts/             migrate, seed, demo, validation, smoke
data/media/          Encrypted private files — outside the served tree, never committed
```

### Layer rules

| Layer | May import | Must not |
| --- | --- | --- |
| `lib/content` | nothing but types | — |
| `lib/engines` | `lib/content` | touch the database, read `next/headers`, perform I/O |
| `lib/media` | `node:crypto`, `node:fs` | touch the database, know about users or consent |
| `lib/services` | `lib/engines`, `lib/db`, `lib/auth`, `lib/media` | contain planning or filtering rules |
| `app/**` | `lib/services`, `components` | query the database directly |

This is why the engines carry the bulk of the 549 unit tests, which run in about a
second with no database: they are ordinary functions over plain data.

## Data flow for a generated plan

```
userProfiles ─┐
gym_equipment ├─► lib/services/plans.buildPlanDraft()
preferences  ─┘            │
                           ▼
          lib/engines/workout-generator.generatePlan()
                           │   (pure: profile + Set<equipmentId> in, plan out)
                           ▼
              lib/services/plans.savePlan()
                           │
                workout_plans → workout_days → planned_exercises
                           │
          lib/services/sessions.materialiseWeek()
                           │
                   workout_sessions  (plannedSnapshot frozen per session)
                           │
                GuidedMode logs → exercise_logs → session_feedback
                           │
         lib/engines/progress.detectMilestones() → performance_milestones
```

The **frozen snapshot** is the key decision. When a session is materialised, the
prescription is copied into `workout_sessions.planned_snapshot`. Regenerating a plan or
accepting a RealitySync proposal writes to new rows or to the snapshot of a *scheduled*
session; completed sessions are immutable.

## Technical decisions

### Deterministic generation, not a language model
The workout generator is seeded from `(userId, weekStart, dayOfWeek, splitKind)`, so the
same inputs always produce the same plan. That makes it testable, auditable and
explainable. A language model cannot produce a plan that satisfies a hard equipment
constraint reliably, and cannot explain itself in a way you can verify. The optional LLM
provider interface in `lib/services/fitbrain.ts` can only rephrase an answer the rules
already computed.

### SQLite with Drizzle, designed for PostgreSQL
Local development uses `better-sqlite3` (synchronous, no server, prebuilt binaries). The
schema deliberately avoids SQLite-only constructs:

- ids are `text` (UUID/slug) rather than autoincrement integers
- timestamps are ISO-8601 UTC strings, which sort and port cleanly
- money is **integer paise** (`amount_paise`, `price_paise`) — never floats
- loads are **integer grams** (`weight_grams`)
- JSON columns use Drizzle's typed `text({ mode: 'json' })`

See `DEPLOYMENT.md` for what moving to PostgreSQL actually requires.

### Server Actions for mutations, route handlers for JSON
Server Actions carry the framework's own origin checks. The two JSON route handlers
(`/api/preview/plan`, `/api/fitbrain`) call `assertSameOrigin()` and `requireJson()`
explicitly, because route handlers do not get that for free.

### Authorization in the SQL predicate
Every service function that takes an id also takes a `userId`, and the ownership check is
part of the `WHERE` clause:

```ts
db.select().from(workoutSessions)
  .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)))
  .get();
```

Nothing is fetched and then filtered in application code, so there is no path where a
forgotten check leaks a row. `tests/integration/authorization.test.ts` drives every such
function with a second account's ids.

### Entitlements enforced server-side
`lib/engines/entitlements.ts` holds the matrix; `lib/services/entitlements.ts` adds usage
counts and throws `EntitlementError`. Every gated write path calls `requireEntitlement`.
Hiding a button is a UI nicety, not a limit.

### Idempotency
- `exercise_logs` has a unique index on `(session_id, exercise_id, set_index)` and logging
  upserts, so a double-tap or a refresh cannot duplicate a set.
- `workout_sessions.completion_key` is unique, so a resubmitted completion cannot create
  a second one.
- `materialiseWeek` skips dates that already have a session.

### Rendering and streaming
Most routes are dynamic (they read the session cookie). `loading.tsx` exists only on
`/progress` and `/calendar` — the two heaviest pages that never call `notFound()`.
A Suspense boundary above a page that calls `notFound()` flushes the shell first and
locks in a 200 status, so detail pages deliberately have no loading boundary and return a
correct 404.

### Accessibility as stored preference
Reduced motion, larger text and higher contrast are stored on the profile and applied as
`data-*` attributes on `<html>`, so they affect everything including chart SVGs. The OS
`prefers-reduced-motion` setting is honoured independently.

## Engine inventory

| Module | Responsibility |
| --- | --- |
| `engines/equipment.ts` | Expansion of implied equipment; any-of requirement checking |
| `engines/programming.ts` | Age-banded sets/reps/rest; feedback response; limitation filters |
| `engines/workout-templates.ts` | Movement-pattern slot templates per focus |
| `engines/workout-generator.ts` | Split choice, candidate scoring, time fitting, gap reporting |
| `engines/substitution.ts` | Ranked replacements with training-family guards |
| `engines/realitysync.ts` | The seven adaptation scenarios |
| `engines/nutrition.ts` | Recipe evaluation, filtering, meal planning |
| `engines/grocery.ts` | Consolidation, pantry subtraction, pantry-based suggestions |
| `engines/progress.ts` | Milestones, weekly metrics, trends, neutral consistency copy |
| `engines/entitlements.ts` | Plan matrix and limit decisions |
| `engines/fitbrain-intents.ts` | Deterministic intent rules |
| `engines/rng.ts` | Seeded PRNG for reproducible generation |
| `engines/care.ts` | Product expiry and period-after-opening, routine due dates, conservative patch-test verdicts, neutral adherence copy |
| `engines/outfit.ts` | Colour harmony, formality and weather scoring; explained suggestions; wardrobe gaps. No body model exists in it, by design |
| `engines/voice-metrics.ts` | Pace against a known script, pause and energy analysis over raw samples, neutral practice suggestions |
| `engines/hygiene.ts` | Cadence arithmetic for three cadences, supply runway, neutral activity summaries |
| `engines/review.ts` | The cross-module review. Two hard rules in code: no shaming, and no observation without a row behind it |

### The media layer

`lib/media` sits beside `lib/auth` rather than inside `lib/services`, because it knows
nothing about users, consent or entitlements — it seals bytes and strips metadata, and
that is all. `lib/services/media.ts` is the layer that knows *who* may do it:

```
app/api/media/[id]   authenticate → ownership or grant (in SQL) → decrypt → serve
app/api/media        strict same-origin → authenticate → age → consent → entitlement
                     → type + size → strip metadata → seal → write 0600 → insert row
```

The order in the write path is deliberate. Every check runs before a byte is read, and
metadata is stripped *before* encryption, so the plaintext that reached the disk never
contained it either. There is no code path that writes `private_media_assets` without
going through this service, and no static path that serves what it wrote.
