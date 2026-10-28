# Roadmap

## Completed in this build

### Phase 0 — Foundation
Next.js 16 App Router with React 19 and strict TypeScript. Drizzle schema covering all
required entity groups with committed migrations. scrypt authentication with
server-managed sessions, HTTP-only cookies, expiry, revocation and rate limiting. Design
system with light/dark themes and accessibility preferences. Vitest and Playwright
configured.

**Gate met:** the application starts, authentication works, data persists.

### Phase 1 — Equipment DNA and the exercise library
57 equipment types across 8 categories with implied-equipment relationships. Multiple
gym profiles with per-item availability. 172 exercises across 23 movement patterns with
any-of requirement groups, substitutes, progressions and regressions. Searchable explorer
with availability, level and age filtering. Review-status model with source records.

**Gate met:** a user can create equipment profiles and search exercises without ever
being offered something they cannot do.

### Phase 2 — WorkoutOS and GuidedMode
Deterministic, seeded generator with split selection, movement-pattern templates,
candidate scoring, time fitting and transparent gap reporting. Age-banded programming
rules. Plan editing with constraint re-checking. GuidedMode with large controls, rest and
hold timers, idempotent set logging, mid-session substitution and session feedback.

**Gate met:** a user can generate, modify, complete and save a workout end to end.

### Phase 3 — RealitySync
All seven scenarios, each producing an explainable proposal the user accepts, edits or
rejects. Plan revisions recorded. Completed sessions immutable.

**Gate met:** changing equipment, time or availability produces a suitable updated plan
without corrupting history.

### Phase 4 — NutritionOS
79 India-first recipes over 134 ingredients. Allergens derived from ingredients and
applied as a hard filter on generation, swaps and groceries. Deterministic weekly meal
planner. Grocery consolidation with pantry subtraction. Pantry tracking with suggestions.

**Gate met:** a user can generate and edit a meal plan and grocery list while declared
restrictions are respected throughout.

### Phase 5 — FitBrain and ProgressOS
Rule-based assistant with 13 intents, grounded answers with sources, preference memory
and safety redirects. Progress analytics built only from logged sets, with milestone
detection and neutral consistency reporting.

**Gate met:** the assistant retrieves authorised information, explains recommendations
and never bypasses the planning restrictions.

### Phase 6 — Product UX
Today dashboard, calendar, in-app notifications, responsive layout across three
viewports, light and dark mode, accessibility preferences, installable PWA with a
scoped service worker.

**Gate met:** all major workflows operate across supported screen sizes.

### Phase 7 — Subscription foundation
Entitlement matrix enforced server-side on every gated write path. Pricing page generated
from the real matrix. Billing settings showing live usage against limits. Razorpay
integration boundary with no fake payments.

**Gate met:** free and premium capabilities are correctly enforced without fake payments.

### Phase 9 — Verification
Unit and integration tests, end-to-end tests across three viewports, a 10-point critical
safety suite, content validation, a security review that found and fixed three real bugs,
and this documentation set.

### Phase 10 — Personal wellness modules
Photo journal and check-ins, skincare and grooming, Style OS, Voice and communication
OS, hygiene routines, and the unified cross-module review — 15 routes, 27 tables, an
encrypted private-media pipeline, and five new FitBrain capabilities with three new
honest refusals. Built against the existing accounts, authorization, entitlements,
consent, export and deletion rather than beside them. See [WELLNESS.md](WELLNESS.md).

Each module was then adversarially audited by an independent pass, which produced 26
findings — including an application-wide `Permissions-Policy` that silently made the
voice recorder impossible, a fabricated 0.5 colour score presented as a measurement, a
patch-test outcome that defaulted to the reassuring answer, and encrypted media that was
not in `.gitignore`. All of them are recorded in `SECURITY.md` or were fixed in place.

---

## Deferred

### Phase 8 — Advanced features

| Item | Why it was deferred |
| --- | --- |
| **GymScan photo recognition** | Shipping an image model would mean either a paid API (excluded by design) or an unverified local model. A recognition feature that is wrong is worse than manual entry, so GymOS ships manual entry and a clean boundary. |
| **Offline workout logging** | Requires an outbox, conflict resolution and a sync protocol. The PWA caches reading; writing needs a connection, and the offline page says so. |
| **Expanded recipe library** | 79 recipes is enough to plan a varied week. Growth should follow professional review, not precede it. |
| **Coach review architecture** | Authorization boundaries exist. Trainer accounts need qualification verification, which is an operational process. |
| **Gym partner portal** | Venue and inventory tables with review status exist. A multi-tenant portal is its own product. |
| **Biometric integrations** | Consent records and data shapes exist. Connecting them needs platform entitlements and a native shell. |
| **Speech recognition for voice practice** | Needs either a paid API (excluded by design) or a local model whose accuracy has been measured. A transcript that is wrong is worse than none, and a *simulated* one would be a lie. So GymOS measures what it honestly can and says plainly that nothing is transcribed. |
| **Photo or voice capture for under-18 accounts** | Needs a verified parental-consent mechanism and a legal review of children's-data rules in each jurisdiction. Refused at the service layer until both exist. Every other personal-care feature is available to them. |
| **Media key rotation** | Needs a re-encryption pass with a key-version column and a tested rollback. Changing `GYMOS_MEDIA_KEY` today makes existing files unreadable, which `ENVIRONMENT.md` states plainly. |
| **Creating a media share** | The grant model, the authenticated read path and the revoke controls all exist and are tested. What is missing is how you name a recipient: an email lookup would leak whether an account exists, and GymOS has no other user-discovery surface by design. Needs an invite-token design, not a search box. |
| **Photographs on a skincare journal entry** | Skin photographs live in the photo journal, which has a dedicated `skin` view and one privacy surface. A second place to attach photos would split the consent and deletion controls, so the skincare page points at the journal instead of offering a field. |

### Not started

- Community and social features — deliberately secondary, and easy to get wrong in a way
  that harms users.
- Localisation beyond storing language and timezone.
- Push and email notifications.

---

## Next priorities

In the order they should actually be done:

1. **Professional content review.** Everything reads `draft`. A qualified coach and a
   qualified dietitian signing off the library is the single highest-value next step, and
   it blocks any public launch.
2. **Legal review**, especially children's-data rules, since under-13 accounts are
   supported — and specifically a parental-consent mechanism, which is the only thing
   standing between under-18 accounts and the photo and voice features.
3. **Email provider.** Without it there is no password reset, so a forgotten password is
   an unrecoverable account.
4. **Backups and a tested restore**, including the encrypted media directory and its
   key. A database backup without the key restores unreadable files.
5. **Independent security review.**
6. **Content-Security-Policy with nonces** (`SECURITY.md` residual risk 2).
7. **Async service layer and PostgreSQL** (`DEPLOYMENT.md`) — needed before more than one
   instance can run.
8. **Component tests and an automated accessibility audit** to close the stated gaps in
   `TESTING.md`.
9. **Honour the stored timezone.** Every "today" is currently computed in UTC, so for an
   India-first product the day turns over at 05:30 local. The profile already stores a
   timezone; nothing reads it. This touches every date computation, so it is a single
   deliberate change rather than something to patch per page.
10. **Razorpay**, only after 1–5.
11. **GymScan**, only with a model whose accuracy has been measured.

---

## Explicitly blocked

| Item | Blocked on |
| --- | --- |
| Live payments | Credentials, webhook verification, consumer disclosures, legal review |
| Wearable sync | Platform entitlements and a native shell |
| Publishing content as professionally reviewed | A named qualified reviewer and an audit trail |
| Claiming any compliance certification | An actual audit |
| Trainer marketplace | Qualification verification procedures |
| Photo or voice capture for under-18 accounts | A verified parental-consent mechanism and a legal review |
| Any automated judgement of appearance or voice | Nothing. This is not blocked, it is refused: there is no schema column for it and a test fails if one appears |
