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
| Unit | 21 | 549 | **pass** |
| Integration | 12 | 320 | **pass** |
| **Vitest total** | **33** | **869** | **pass** (≈ 11 s) |
| End-to-end (desktop / tablet / mobile) | 4 | 64 | **pass** (≈ 59 s) |
| TypeScript (`tsc --noEmit`, strict) | — | — | **0 errors** |
| ESLint (incl. React Compiler rules) | — | — | **0 errors, 0 warnings** |
| Production build | — | — | **success** |
| `npm audit --omit=dev` | — | — | **0 vulnerabilities** |
| Content validation (`validate:content`) | 172 exercises, 79 recipes | — | **0 issues** |
| Voice script integrity | 15 scripts | — | **pass** — every script's stored word count is recomputed from its text in `unit/voice-metrics.test.ts`, which is what makes the words-per-minute figure a measurement rather than a guess. Not part of `validate:content` |

### Coverage

```
File      | % Stmts | % Branch | % Funcs | % Lines
----------|---------|----------|---------|--------
All files |   83.95 |    76.60 |   80.78 |   85.55
 content  |   81.59 |    72.35 |  100.00 |   85.71
 engines  |   94.73 |    87.72 |   97.69 |   96.17
 services |   82.05 |    70.37 |   84.71 |   84.61
 media    |   71.72 |    69.56 |   80.00 |   73.68
```

Coverage is highest where it matters: the domain engines, which hold every safety rule,
and `services/media.ts` at 96.7% of lines, which is the one place private files are
written, served and deleted. The `media` directory figure is lower than its service
because `strip-metadata.ts` carries branches for malformed containers that the tests
reach selectively. The uncovered remainder in `services` is mostly list/read helpers
exercised through the UI and the end-to-end suite rather than directly.

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
| 11 | No appearance, attractiveness or body score can exist | `unit/journal-safety.test.ts` scans the exported schema for a column that could hold one; `unit/fitbrain-wellness.test.ts` asserts every appearance question routes to a refusal |
| 12 | No skin or health condition is diagnosed | `unit/care.test.ts` — a patch test is `in_progress` until its window closes and never returns a verdict; `integration/fitbrain.test.ts` — skin questions route to a refusal that names a professional |
| 13 | Nothing is transcribed and no voice is judged | `unit/voice-metrics.test.ts` — no transcript-shaped field exists and no output carries voice-quality vocabulary; words per minute is `null` without a script |
| 14 | A measurement is never invented | `unit/voice-metrics.test.ts`, `integration/voice.test.ts` — every stored figure is `measured` or `self_reported`, and the distinction is a database column |
| 15 | The review never shames and never invents | `unit/review.test.ts` — the worst-looking inputs the suite can construct (everything planned, nothing done) carry no shaming or grading vocabulary, and an empty module says so rather than producing an insight |
| 16 | Private media cannot be read by another account | `integration/media.test.ts` — a second account gets the same error for a real id as for one that never existed; `e2e/wellness.spec.ts` asserts the 404 over HTTP |
| 17 | Media is encrypted at rest with its metadata removed | `integration/media.test.ts` — the bytes on disk are not the photograph, EXIF and GPS strings are gone, and a tampered file is refused |
| 18 | Deleting media really deletes it | `integration/media.test.ts` — the file leaves the disk, the row goes, and an auditable event records whether the file actually went |
| 19 | Withdrawing a media consent destroys that media | `integration/media.test.ts` |
| 20 | Media capture is refused for under-18 accounts | `integration/media.test.ts` and `e2e/wellness.spec.ts` — refused at the server, not merely hidden, and the consent cannot be granted either |
| 21 | No cleanliness score and no shaming in routines | `unit/hygiene.test.ts`, `unit/care.test.ts` |
| 22 | Outfit suggestions never involve a body | `unit/outfit.test.ts` — no output field or explanation carries body or appearance vocabulary |
| 23 | Headers permit what features need and nothing more | `unit/headers.test.ts` — asserted against the real `next.config.ts` |
| 24 | Encrypted media and its key are never committed | `unit/repo-hygiene.test.ts` |

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

### From the wellness modules

7. **The microphone was disabled application-wide.** `Permissions-Policy` carried
   `microphone=()`, so the voice recorder could never have worked. Found by reading the
   header in a real browser rather than trusting the component, and now guarded by
   `unit/headers.test.ts`.
8. **"Metadata stripped" was reported unconditionally**, including for files that
   contained no metadata — so the privacy screen could claim something had been removed
   when nothing had. Caught by a test asserting a second pass over a clean file reports
   nothing removed.
9. **Audio metadata was not stripped at all.** Only images were, so an uploaded MP3 kept
   its ID3 frames. Found while writing the test that asserted the opposite.
10. **`Referrer-Policy: no-referrer` on media responses was silently overridden** by a
    `next.config.ts` header for every path. Found by reading the response in a browser.
11. **Encrypted media and the development key were not in `.gitignore`**, so a `git add .`
    would have committed both the files and the means to decrypt them. Now guarded by
    `unit/repo-hygiene.test.ts`.
12. **A rounded "0 KB freed"** in the deletion log read as though nothing had been
    deleted, for any file under a kilobyte.

An independent adversarial audit of each module then produced 26 further findings,
including a hardcoded 0.5 colour score presented to the user as a measurement, a
patch-test outcome that defaulted to the reassuring answer when none was given, a
hygiene tick that could not be undone because the card vanished on completion, and five
safety tests that did not actually test what their names promised. Those are fixed in
place; the ones that changed a documented behaviour are recorded in `SECURITY.md`.

## Testing principles used here

- **No test was weakened to make it pass.** Where a test failed, either the code was
  wrong (bugs 1–4 above) or the assertion was testing the wrong thing — for example a
  regex that matched GymOS's own reassurance text (*"no calorie targets"*) rather than an
  actual calorie target. Those assertions were made more precise, not more permissive.
- **Safety properties are asserted structurally**, not by string matching where possible:
  the minor-safety test checks the prescription object, not the explanatory copy.
- **Integration tests use the shipped migrations and the shipped content**, so a schema
  or data change that breaks the app breaks the tests.
- **A safety test must be able to fail.** Several of the first wellness safety tests were
  decorative — a forbidden-string assertion over fixtures that could never produce the
  string, or a "no gaps" test that ruled out one of four gap kinds. An assertion that
  cannot fail is worse than no assertion, because it reads as a guarantee. Those were
  rewritten to cover the branch that would actually break.
- **Prefer a structural guard to a wordlist.** A list of banned words catches the obvious
  case and misses a neutral name for the same thing, so where a guarantee is structural —
  no column could hold an appearance score, no return shape carries a derived metric —
  the test asserts the structure.

## Known gaps in the test suite

- No component-level React tests. Interface behaviour is covered end-to-end instead.
- No load or performance testing.
- No automated accessibility audit (axe). The end-to-end suite checks structural basics
  only; a full WCAG audit with assistive technology has not been done.
- The end-to-end suite runs on Chromium only; WebKit and Firefox are not installed.
- **The voice recorder's audio analysis is not covered end-to-end.** The pure analysis is
  unit-tested over synthetic buffers, and the upload, serving and deletion paths are
  covered against real files, but no test drives a real microphone. Playwright's fake
  media stream would exercise the plumbing without validating the maths, so the honest
  position is that the browser half of the measurement is unit-tested and manually
  checked, not end-to-end verified.
- **Server-side verification of voice measurements is impossible by design**, since the
  analysis runs in the browser. The tests assert that nothing is invented when no
  analysis arrives; they cannot assert that a client sent honest numbers.
