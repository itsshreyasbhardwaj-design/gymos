# Testing

## Commands

```bash
npm test                 # unit + integration (Vitest)
npm run test:unit        # engines and content only — no database
npm run test:integration # database-backed service and authorization tests
npm run test:coverage    # with coverage
npm run test:e2e         # production build, then Playwright across three viewports
npm run verify           # typecheck → lint → test → build
```

## Verified results

Recorded from an actual run of this build.

| Suite | Files | Tests | Result |
| --- | --- | --- | --- |
| Unit | 11 | 224 | **pass** |
| Integration | 5 | 93 | **pass** |
| **Vitest total** | **16** | **317** | **pass** (≈ 5 s) |
| End-to-end (desktop / tablet / mobile) | 2 | 59 | **pass** (≈ 47 s) |
| TypeScript (`tsc --noEmit`, strict) | — | — | **0 errors** |
| ESLint (incl. React Compiler rules) | — | — | **0 errors, 0 warnings** |
| Production build | — | — | **success** |
| `npm audit --omit=dev` | — | — | **0 vulnerabilities** |
| Content validation | 172 exercises, 79 recipes | — | **0 issues** |

### Coverage

```
File      | % Stmts | % Branch | % Funcs | % Lines
----------|---------|----------|---------|--------
All files |   79.96 |    72.08 |   75.37 |   81.46
 content  |   80.00 |    71.55 |  100.00 |   84.55
 engines  |   93.34 |    85.09 |   96.42 |   94.84
 services |   76.78 |    63.91 |   80.62 |   79.58
```

Coverage is highest where it matters: the domain engines, which hold every safety rule.
The uncovered remainder in `services` is mostly list/read helpers exercised through the
UI and the end-to-end suite rather than directly.

## Strategy

### Unit — `tests/unit/` (no database, no I/O)

The engines are pure functions over plain data, so they test fast and exhaustively.

| File | Covers |
| --- | --- |
| `content.test.ts` | Catalog integrity: no duplicate ids, every equipment and substitute reference resolves, every movement pattern is covered, allergens derive correctly, no invented nutrition data |
| `equipment.test.ts` | Implied-equipment expansion, any-of groups, **all** groups required, optional never gates, coverage ordering across presets |
| `programming.test.ts` | Age-band caps, rep/rest selection, feedback asymmetry, limitation filters |
| `generator.test.ts` | Determinism, split selection, equipment compliance, level and age gating, dislikes, time fitting, gap reporting, rationale |
| `realitysync.test.ts` | All seven scenarios, plus substitution ranking and the training-family guard |
| `nutrition.test.ts` | Diet filters, dislikes, time/skill limits, plan variety, swap filtering, date helpers |
| `grocery.test.ts` | Scaling, unit-safe summing, pantry subtraction, optional handling, price honesty |
| `entitlements.test.ts` | Matrix consistency, limit behaviour, billing honesty |
| `progress.test.ts` | Milestone detection, weekly metrics, trends, neutral consistency copy |
| `fitbrain.test.ts` | Intent routing, safety priority, capability coverage |
| `safety.test.ts` | **The critical safety suite** — see below |

### Integration — `tests/integration/` (real SQLite)

Each file gets its own temporary database file, built from the **committed migration
SQL** and seeded with the real content library, so tests exercise exactly the schema and
data that ship.

| File | Covers |
| --- | --- |
| `account.test.ts` | Registration, duplicate/weak/invalid rejection, authentication, password change, profile persistence and history, consent recording |
| `workflow.test.ts` | The full domain workflow: equipment → plan → schedule → log → complete → adapt → nutrition → groceries, including idempotency and entitlement enforcement |
| `authorization.test.ts` | **Cross-user isolation** across every id-taking function |
| `privacy.test.ts` | Consent gating, export completeness, hard deletion with an orphan check |
| `fitbrain.test.ts` | Grounded answers from real records, safety redirects, memory feeding the generator, action limits |

### End-to-end — `tests/e2e/` (Playwright, production build)

Runs against `next start` with a dedicated database, so it never touches development
data.

- `journey.spec.ts` — the complete 23-step journey from the brief: register, onboard,
  select equipment, generate a plan, open an exercise, start a workout, log sets,
  complete it, see progress update, hit the free-plan limit, upgrade, create a second
  equipment profile, run RealitySync and apply it, set dietary preferences and an
  allergy, generate a meal plan, swap a meal, build a grocery list, review progress,
  update settings, export data, log out, and confirm protected routes stay protected.
  Plus a browser-level cross-user isolation test.
- `public.spec.ts` — every public route, the live homepage preview, honesty assertions
  (payments not enabled, no wearable integration), 404 handling, and accessibility
  basics (one `h1` per page, skip link, labelled controls, dark mode). Runs on **desktop
  (1280×900), tablet (834×1112) and mobile (Pixel 7)**.

## The critical safety tests

Each maps to a non-negotiable requirement.

| # | Guarantee | Where |
| --- | --- | --- |
| 1 | No unavailable equipment is ever assigned | `safety.test.ts` — every preset × age band × experience combination |
| 2 | **Every** required equipment group is checked | `safety.test.ts` — drops each group in turn and asserts the exercise is blocked |
| 3 | A declared limitation removes the movement from generation, substitution **and** adaptation | `safety.test.ts` |
| 4 | GymOS never invents an equipment-free replacement | `safety.test.ts` — gap reported, slot absent, no stretch or cardio substituted for strength work |
| 5 | A missed session never triggers extra training | `safety.test.ts` — only `reschedule`/`remove` changes, explicit guarantee text |
| 6 | Declared allergens are excluded everywhere, including swaps and the grocery list | `safety.test.ts` — every allergen, every slot |
| 7 | Under-18 accounts get no restrictive diet and no appearance scoring | `safety.test.ts` — server refuses the settings; no calorie/weight language in the prescription; catalog free of appearance framing |
| 8 | Medical input never produces treatment advice | `safety.test.ts` — intent routing plus adaptation text |
| 9 | Private data cannot be reached by another user | `integration/authorization.test.ts` + a browser test |
| 10 | Biometric collection requires consent | `integration/privacy.test.ts` |

## Bugs the tests found

The suite earned its keep during development:

1. **Child's pose offered as a lat-pulldown substitute** — both tag `lats`. Fixed with a
   training-family guard; regression test added.
2. **Equipment counts always zero** — a correlated subquery returned 0 for every profile,
   so the Equipment page understated every inventory. Caught by the workflow integration
   test.
3. **404 served with a 200 status** — a loading boundary flushed the response before
   `notFound()` ran. Caught by the browser isolation test.
4. **Missing injury phrasings** in the FitBrain safety rules ("I tore something",
   "pulled a muscle", "is it safe to train") routed to `unknown` instead of the safety
   redirect.
5. **An advertised FitBrain example that did not work** — "Something else for Thursday
   dinner" matched no rule. Caught by a test asserting every advertised capability
   example routes to its own capability.
6. **Recipe data errors** — unit mismatches on tempering ingredients, two ingredients
   referenced that did not exist, and diet tags that disagreed with the ingredient list.
   All caught by the content validator before they could reach a user.

## Testing principles used here

- **No test was weakened to make it pass.** Where a test failed, either the code was
  wrong (bugs 1–4 above) or the assertion was testing the wrong thing — for example a
  regex that matched GymOS's own reassurance text (*"no calorie targets"*) rather than an
  actual calorie target. Those assertions were made more precise, not more permissive.
- **Safety properties are asserted structurally**, not by string matching where possible:
  the minor-safety test checks the prescription object, not the explanatory copy.
- **Integration tests use the shipped migrations and the shipped content**, so a schema
  or data change that breaks the app breaks the tests.

## Known gaps in the test suite

- No component-level React tests. Interface behaviour is covered end-to-end instead.
- No load or performance testing.
- No automated accessibility audit (axe). The end-to-end suite checks structural basics
  only; a full WCAG audit with assistive technology has not been done.
- The end-to-end suite runs on Chromium only; WebKit and Firefox are not installed.
