# Feature inventory

Status values:

- **Completed and verified** — implemented, and covered by a passing automated test
- **Implemented, not fully verified** — works, but without full automated coverage
- **Partially implemented** — usable, with a stated limitation
- **Architecture only** — data model and boundaries exist; no working feature
- **Not implemented** — absent, and the interface says so

---

## Accounts and onboarding

| Feature | Status | Notes |
| --- | --- | --- |
| Email/password accounts | Completed and verified | scrypt, server sessions, HTTP-only cookies |
| Login rate limiting | Completed and verified | Per account and per IP, database-backed |
| Password change | Completed and verified | Revokes all other sessions |
| Session listing and revocation | Implemented, not fully verified | UI covered end-to-end, not unit tested |
| Nine-step onboarding | Completed and verified | Full journey covered by Playwright |
| Age-banded experience | Completed and verified | under_13 / teen_13_17 / adult_18_plus enforced server-side |
| Accessibility preferences | Implemented, not fully verified | Reduced motion, larger text, higher contrast, stored and applied |
| Email verification | Not implemented | Needs an email provider |
| Password reset | Not implemented | Needs an email provider; account recovery is impossible |
| Multi-factor authentication | Not implemented | |

## Equipment DNA

| Feature | Status | Notes |
| --- | --- | --- |
| Equipment catalog (57 types, 8 categories) | Completed and verified | |
| Implied equipment | Completed and verified | Power rack → squat rack + pull-up bar, etc. |
| Any-of requirement groups | Completed and verified | Every group required; tested by dropping each in turn |
| Multiple equipment profiles | Completed and verified | Free: 1, Pro: 10, enforced server-side |
| Active profile switching | Completed and verified | |
| Mark equipment unavailable | Completed and verified | |
| Custom equipment entries | Partially implemented | Stored and listed; custom items do not yet appear in exercise requirements, and the UI says so |
| Per-item detail (weight range, notes) | Implemented, not fully verified | Service exists; no dedicated UI |
| Coverage reporting per profile | Completed and verified | Shows exactly which patterns a setup cannot train |
| GymScan photo recognition | Not implemented | No vision model ships; the UI states this |

## Exercise library

| Feature | Status | Notes |
| --- | --- | --- |
| 172 exercises, 23 movement patterns | Completed and verified | Validator enforces structure |
| Full metadata | Completed and verified | Pattern, muscles, equipment groups, level, setup, steps, cues, safety, relationships |
| Search and filtering | Implemented, not fully verified | Name, muscle, pattern, level, availability, favourites, recently performed |
| Exercise detail pages | Completed and verified | Including honest "no demonstration media" |
| Substitution suggestions | Completed and verified | Ranked, with training-family guard |
| Favourites and dislikes | Completed and verified | Feed the generator |
| Review status and sources | Completed and verified | Everything reads `draft`, labelled everywhere |
| Professional review | Not implemented | Operational process, not a code feature |
| Demonstration media | Not implemented | No licensed media ships |

## WorkoutOS

| Feature | Status | Notes |
| --- | --- | --- |
| Deterministic generator | Completed and verified | Seeded; same inputs → same plan |
| Split selection (1–6 days) | Completed and verified | By day count, experience and interests |
| Movement-pattern templates | Completed and verified | 8 focus types |
| Equipment filtering | Completed and verified | Safety test 1 |
| Age-banded programming | Completed and verified | Safety test 7 |
| Limitation filtering | Completed and verified | Safety test 3 |
| Time fitting | Completed and verified | Accessories → rest → sets, floors protected |
| Transparent gap reporting | Completed and verified | Safety test 4 |
| Per-exercise rationale | Completed and verified | |
| Plan editing (swap/remove/add/re-dose) | Completed and verified | Every change re-checks constraints |
| Plan versioning | Completed and verified | Old plans retained; completed sessions immutable |

## GuidedMode

| Feature | Status | Notes |
| --- | --- | --- |
| Exercise-by-exercise player | Completed and verified | |
| Large controls, minimal typing | Implemented, not fully verified | Steppers, 64px primary action |
| Rest timer | Implemented, not fully verified | Deadline-based, +30 s and skip |
| Hold timer for timed exercises | Implemented, not fully verified | |
| Set logging with weight/reps/duration | Completed and verified | Idempotent on (session, exercise, set) |
| Undo last set | Implemented, not fully verified | |
| Mid-session substitution | Completed and verified | |
| Crash-safe progress | Completed and verified | Written to the server as you log |
| Session feedback | Completed and verified | Difficulty, recovery, discomfort |
| Discomfort handling | Completed and verified | Always reduces; refers to a professional |
| Session summary | Completed and verified | |
| Imperial/metric units | Implemented, not fully verified | |

## RealitySync

| Feature | Status | Notes |
| --- | --- | --- |
| Equipment change (A) | Completed and verified | |
| Less time (B) | Completed and verified | |
| Missed session (C) | Completed and verified | Safety test 5 |
| Equipment unavailable (D) | Completed and verified | |
| Session too hard (E) | Completed and verified | |
| Travel (F) | Completed and verified | |
| Schedule change (G) | Completed and verified | |
| Explainable proposals | Completed and verified | What, why, inputs, equipment confirmation, alternatives |
| Accept / reject / revert | Completed and verified | |
| Plan revision history | Completed and verified | |
| History protection | Completed and verified | Completed sessions can never be re-planned |

## NutritionOS

| Feature | Status | Notes |
| --- | --- | --- |
| 79 recipes, 134 ingredients | Completed and verified | India-first |
| Derived allergen tags | Completed and verified | From ingredients, including optional ones |
| Hard allergen filtering | Completed and verified | Safety test 6 — generation, swaps and groceries |
| Diet filtering | Completed and verified | Vegan, vegetarian, eggetarian, non-vegetarian |
| Optional-ingredient omission | Completed and verified | Keeps a recipe usable without lying about it |
| Dislike filtering | Completed and verified | Required vs optional handled differently |
| Time and skill limits | Completed and verified | |
| Weekly meal planner | Completed and verified | Deterministic, variety-constrained |
| Meal swapping | Completed and verified | Re-validated server-side |
| Exclusion reporting | Implemented, not fully verified | Counts shown by kind |
| Minor safeguards | Completed and verified | Server refuses restriction settings |
| Medical dietary warning | Completed and verified | |
| Nutritional analysis | Not implemented | No sourced data ships |

## Grocery and pantry

| Feature | Status | Notes |
| --- | --- | --- |
| Consolidated list generation | Completed and verified | Unit-safe |
| Pantry subtraction | Completed and verified | Unit-matched only; covered items reported |
| Tick off, add, remove items | Implemented, not fully verified | |
| Shareable read-only lists | Completed and verified | 128-bit token; exposes only names and quantities |
| Recurring lists | Not implemented | Column exists, no UI |
| Pantry tracking | Completed and verified | |
| Recipes from pantry | Completed and verified | Respects allergens and diet |
| User-recorded prices | Completed and verified | The only source of cost estimates |
| Shipped price data | Not implemented | None exists; the UI says so |

## FitBrain

| Feature | Status | Notes |
| --- | --- | --- |
| Rule-based intent routing | Completed and verified | 13 intents |
| Grounded answers with sources | Completed and verified | |
| Preference memory | Completed and verified | Feeds the generator; inspectable and deletable |
| Safety redirects | Completed and verified | Safety test 8 |
| Action limits | Completed and verified | Free: 10/day |
| Language-model answers | Not implemented | No model, no API key; provider interface can only rephrase |

## ProgressOS and biometrics

| Feature | Status | Notes |
| --- | --- | --- |
| Weekly metrics and charts | Implemented, not fully verified | Engine unit tested; charts covered end-to-end |
| Milestone detection | Completed and verified | From logged sets only |
| Muscle balance | Completed and verified | |
| Exercise trends | Completed and verified | |
| Neutral consistency reporting | Completed and verified | No streaks, no shaming |
| Activity records | Completed and verified | |
| Optional biometrics | Completed and verified | Safety test 10 — consent-gated, deletable |
| Wearable import | Architecture only | Consent record and data shape; nothing connected |

## Private media

| Feature | Status | Notes |
| --- | --- | --- |
| Encrypted storage (AES-256-GCM) | Completed and verified | Per-file IV, auth tag stored beside the row |
| Metadata stripping | Completed and verified | Real parsing: JPEG `APPn`/`COM`, PNG chunk allowlist, WebP `EXIF`/`XMP `, MP3 ID3v1/v2. Zero dependencies |
| Authenticated serving | Completed and verified | `GET /api/media/[id]` only; no public URL exists |
| Upload endpoint | Completed and verified | Strict same-origin, MIME allowlist, size caps, entitlement cap |
| Ownership and grant-based access | Completed and verified | Owner or an explicit, expiring, revocable grant — in the SQL predicate |
| Creating a share | **Not implemented** | The revoke side is built and tested; nothing creates a grant, so nothing can be shared. Finding a recipient would mean an email lookup that leaks whether an account exists. The privacy screen says so rather than implying the feature |
| Verifiable deletion | Completed and verified | File removed, row deleted, auditable event recording whether the file actually went |
| Destructive consent withdrawal | Completed and verified | Turning a consent off deletes the media collected under it |
| Age gate (18+) | Completed and verified | Refused at the service layer; no parental-consent mechanism exists in this build |
| Tamper detection | Completed and verified | A file altered on disk fails its GCM auth tag and is refused |
| Honest key reporting | Completed and verified | Development-key mode is stated in the UI, in FitBrain and in the export |
| Media key rotation | Not implemented | Stated plainly in `ENVIRONMENT.md`; changing the key makes existing files unreadable |
| Virus / content scanning | Not implemented | Type-checked, size-capped, served sandboxed with `nosniff`; stated in `SECURITY.md` |
| Appearance analysis of any kind | **Deliberately absent** | No score, rating, body-fat estimate, comparison or diagnosis. No schema column could hold one, and a test fails if one appears |
| Face or voice identification | **Deliberately absent** | No biometric recognition anywhere |

## Photo journal and check-ins

| Feature | Status | Notes |
| --- | --- | --- |
| Written journal with categories and tags | Completed and verified | Works fully without any photograph |
| Optional photo attachments | Completed and verified | Consent-gated, 18+, encrypted |
| Photo check-ins | Completed and verified | Opt-in; cadence defaults to `off` and can be set back to `off` |
| Side-by-side comparison of your own photos | Completed and verified | Dates only — nothing computed from the images |
| Automated photo analysis | **Deliberately absent** | Stated on every page that touches a photograph |

## Skincare and grooming

| Feature | Status | Notes |
| --- | --- | --- |
| Routines with ordered steps and day scheduling | Completed and verified | |
| Routine logging, idempotent per day | Completed and verified | Counts only — no score, no streak |
| Product inventory with expiry and period-after-opening | Completed and verified | Earlier of printed expiry and opened + PAO |
| Skin journal | Completed and verified | Your own 1–5 comfort rating and your own words |
| Patch tests | Completed and verified | Conservative: `in_progress` until the window closes; never a dermatological verdict |
| Appointments | Completed and verified | |
| Skin condition diagnosis | **Deliberately absent** | Routed to a qualified professional |
| Photographs attached to a skincare journal entry | Not implemented | Skin photographs live in the photo journal, which has a `skin` view. The page says so rather than offering a field that drops them |

## Style OS

| Feature | Status | Notes |
| --- | --- | --- |
| Digital wardrobe | Completed and verified | Category, colour, fabric, formality, warmth, seasons, occasions |
| Outfit engine | Completed and verified | Colour harmony, formality match and weather suitability only. Fully offline, deterministic, every suggestion explained |
| Saved outfit combinations | Completed and verified | |
| Weekly outfit planner | Completed and verified | Marking a day worn is the only source of the wear counts |
| Wardrobe gap analysis | Completed and verified | Facts about the wardrobe, never about the person |
| Body-shape or "flattering" rules | **Deliberately absent** | The engine has no notion of a body |
| Shopping integration | **Deliberately absent** | Nothing is recommended to buy; no retail API |

## Voice and communication

| Feature | Status | Notes |
| --- | --- | --- |
| Practice script library | Completed and verified | Original text with known word counts |
| In-browser recording and playback | Completed and verified | Consent-gated, 18+, encrypted |
| Timed practice without recording | Completed and verified | What under-18 and consent-off accounts get, and it is a real feature, not a stub |
| Measured metrics | Completed and verified | Duration, pause count, longest pause, speaking ratio — real analysis of the real audio, in the browser |
| Words per minute | Completed and verified | Only with a script, because only then is the word count known. `null` otherwise |
| Self-reported metrics | Completed and verified | Filler tally and clarity, stored with `source: 'self_reported'` |
| Communication goals and history | Completed and verified | |
| Transcription | **Deliberately absent** | No speech model ships, nothing is transcribed, and nothing is simulated |
| Voice quality or accent judgement | **Deliberately absent** | |

## Hygiene

| Feature | Status | Notes |
| --- | --- | --- |
| Routines with ordered tasks | Completed and verified | |
| Three cadences | Completed and verified | Daily, weekly on chosen days, every *n* days |
| Due-task computation | Completed and verified | From cadence and the last check-in; never-done counts as due |
| Idempotent check-ins | Completed and verified | Ticking twice changes nothing |
| Supply tracking and restock flags | Completed and verified | Runway from your own dates and intervals; "unknown" where you gave none |
| Cleanliness score | **Deliberately absent** | Counts only, with no shaming copy — an explicit engine rule, with tests |

## Unified review

| Feature | Status | Notes |
| --- | --- | --- |
| Cross-module review | Completed and verified | Training, food, grooming, wardrobe, voice, hygiene, journal |
| Weekly / fortnightly / monthly / on request | Completed and verified | |
| Selectable sections | Completed and verified | |
| Stored reviews, idempotent per period | Completed and verified | Regenerating a period replaces its copy |
| Your own notes on a review | Completed and verified | |
| Stated limitations in the UI | Completed and verified | Only what you recorded; never reads media; not a health assessment |
| Scores, grades or streaks | **Deliberately absent** | Tested against the worst-looking inputs the suite can construct |

## Platform

| Feature | Status | Notes |
| --- | --- | --- |
| Entitlement enforcement | Completed and verified | Server-side on every gated write |
| Pricing page from the real matrix | Completed and verified | |
| Development plan switch | Completed and verified | No payment involved, and says so |
| Razorpay payments | Architecture only | Integration boundary only; nothing can be charged |
| Data export | Completed and verified | Full JSON, every plan, all 73 tables including the five wellness child tables reached only by a parent id |
| Account deletion | Completed and verified | Hard delete, orphan-checked, and removes the encrypted media files from disk |
| Consent management | Completed and verified | Eight consent kinds; withdrawing a media consent destroys that media immediately |
| Installable PWA | Implemented, not fully verified | Manifest + scoped service worker |
| Offline reading of visited pages | Implemented, not fully verified | App shell and visited exercise/recipe pages |
| Offline write sync | Not implemented | Stated explicitly in the offline page |
| Responsive layout | Completed and verified | Desktop, tablet and mobile covered end-to-end |
| Light and dark mode | Completed and verified | |
| Accessibility basics | Implemented, not fully verified | One h1, skip link, labelled controls, focus rings, ARIA live regions |
| Content admin area | Implemented, not fully verified | Role-gated, read-only review queue |
| Gym partner portal | Architecture only | Venue tables with review status; no portal |
| Trainer features | Not implemented | Consent record only |
| Community/social | Not implemented | Deliberately omitted |
| Notifications | Partially implemented | In-app only, created on discomfort reports; no push or email |
| Localisation | Partially implemented | Language and timezone stored; UI is English only |
| Dates in the user's own timezone | **Not implemented** | Every "today" in the app is computed in UTC, which is the schema's storage convention. The profile stores `Asia/Kolkata` by default but nothing reads it, so for an India-first app the day currently turns over at 05:30 local. This is pre-existing and consistent across every surface, including the new modules, which is why the wellness work did not change it unilaterally — fixing it means threading the stored timezone through every date computation at once. Stated here rather than left for a user to notice |
