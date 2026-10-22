# GymOS

**Fitness that fits real life.**

A personal fitness operating system: equipment-aware workout planning, adaptive
re-planning when your week changes, flexible meal planning, and progress tracking built
only from what you actually logged.

One app. Your equipment. Your workouts. Your meals. Your progress.

---

## What this build is

A working local application. Accounts, onboarding, equipment profiles, workout
generation, guided logging, adaptive re-planning, meal planning, grocery lists and
progress analytics are all implemented against a real database with real domain logic.

It needs **no API keys at all**. No OpenAI, Anthropic, Gemini, Supabase, Firebase,
Google OAuth, wearable, payment, cloud-storage or email credentials. `npm run setup`
and `npm run dev` is the whole thing.

## What this build is not

These are listed up front because a feature list that quietly omits them is a lie:

| Not available | Why |
| --- | --- |
| **Payments** | Razorpay has an integration boundary and nothing else. No card can be charged and there is no fake checkout. |
| **Wearable / health platform sync** | HealthKit and Health Connect have a consent record and a data shape. Nothing is connected. |
| **Photo equipment recognition (GymScan)** | No image-recognition model ships. Equipment set-up is presets, search and manual selection. |
| **Professionally reviewed content** | Exercise and recipe text is an internal draft, labelled `draft` everywhere it appears. |
| **Nutritional analysis** | No sourced calorie or macro data ships, so none is shown. |
| **Grocery price data** | No retail price data ships. Cost estimates come only from prices you record yourself. |
| **Offline write sync** | The PWA caches pages you have visited. Logging needs a connection. |
| **Trainer / gym partner portals** | Data model and authorization boundaries only. |

GymOS gives general fitness information. It is **not** medical, physiotherapy or
dietetic advice, it cannot diagnose anything, and it will never tell you to train
through pain.

---

## Quick start

```bash
npm install
npm run setup       # applies migrations and seeds the content library
npm run dev         # http://localhost:3100
```

Optionally, create a clearly-labelled demo account with a month of fictional data:

```bash
npm run db:demo
# email:    demo@gymos.local
# password: sample-data-tiger-47
```

All demo data is fictional and the account is named so it cannot be mistaken for real
records.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3100 |
| `npm run build` / `npm start` | Production build and server |
| `npm run setup` | Migrate + seed (first-time set-up) |
| `npm run db:migrate` | Apply committed migrations |
| `npm run db:seed` | Seed equipment, exercises, ingredients, recipes, entitlements |
| `npm run db:reset` | Delete the database and rebuild it |
| `npm run db:demo` | Create the demo account with sample data |
| `npm run validate:content` | Structural validation of the content catalogs |
| `npm run smoke:generator` | Print generated plans for several profiles |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, including the React Compiler rules |
| `npm test` | Unit + integration tests (Vitest) |
| `npm run test:coverage` | Tests with coverage |
| `npm run test:e2e` | Build, then Playwright end-to-end tests |
| `npm run verify` | typecheck → lint → test → build |

## The six systems

| System | What it does |
| --- | --- |
| **Equipment DNA** | A structured catalog of 57 equipment types with "implies" relationships. Every exercise declares any-of requirement groups; the generator never assigns equipment you do not have. |
| **WorkoutOS** | A deterministic, seeded generator. Movement patterns first, then the best exercise you can actually do for each slot, with sets/reps/rest from versioned, age-banded programming rules. |
| **RealitySync** | Re-plans when equipment, time, schedule or feedback change. Every proposal shows what changed, why, which inputs were used, and whether equipment requirements are satisfied. |
| **GuidedMode** | One exercise at a time, large controls, rest timer, mid-session swaps. Every set is written to the server as you log it and logging is idempotent. |
| **NutritionOS** | 79 India-first recipes with allergens derived from ingredients and applied as a hard filter on generation *and* on every swap. |
| **FitBrain** | A guided assistant with no language model. Rule-based intent routing over your own records and the content libraries. |
| **ProgressOS** | Charts built only from logged sets. No body-composition predictions, no comparisons, no streak-shaming. |

## Content library

| | Count |
| --- | --- |
| Equipment types | 57 (plus `none`) |
| Exercises | 172 across 23 movement patterns |
| Ingredients | 134 |
| Allergens | 10 |
| Recipes | 79 (Bengali, North Indian, South Indian, everyday home cooking, selected international) |

All of it carries a review status and a source record. Everything currently reads
`draft`.

## Documentation

| File | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layering, data flow, technical decisions |
| [FEATURES.md](FEATURES.md) | Complete feature inventory with implementation status |
| [WORKOUT_ENGINE.md](WORKOUT_ENGINE.md) | Generation, eligibility, substitution, adaptation |
| [EQUIPMENT_ENGINE.md](EQUIPMENT_ENGINE.md) | Catalog, requirement groups, compatibility |
| [NUTRITION_ENGINE.md](NUTRITION_ENGINE.md) | Recipes, allergens, meal planning, groceries |
| [FITBRAIN.md](FITBRAIN.md) | Capabilities, data access, limitations |
| [SECURITY.md](SECURITY.md) | Auth, authorization, sensitive data, residual risks |
| [TESTING.md](TESTING.md) | Strategy, commands and verified results |
| [DEPLOYMENT.md](DEPLOYMENT.md) | What production needs that this build does not have |
| [ROADMAP.md](ROADMAP.md) | Completed, deferred and blocked |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Local configuration and future provider settings |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 ·
Drizzle ORM · SQLite (better-sqlite3) · Zod · Recharts · Lucide · Vitest · Playwright.

## Licence

[MIT](LICENSE). Use it, modify it, ship it.

One caveat worth repeating: the exercise and recipe text in `lib/content/` is an
in-house draft that has **not** been reviewed by a qualified coach or dietitian, and
every record carries `review_status: 'draft'`. The licence lets you reuse it; it does not
make it professionally reviewed. If you put it in front of real users, get it reviewed
first.
