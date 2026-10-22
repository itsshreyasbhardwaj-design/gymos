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
317 unit and integration tests, 59 end-to-end tests across three viewports, a 10-point
critical safety suite, content validation, a security review that found and fixed three
real bugs, and this documentation set.

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
   supported.
3. **Email provider.** Without it there is no password reset, so a forgotten password is
   an unrecoverable account.
4. **Backups and a tested restore.**
5. **Independent security review.**
6. **Content-Security-Policy with nonces** (`SECURITY.md` residual risk 2).
7. **Async service layer and PostgreSQL** (`DEPLOYMENT.md`) — needed before more than one
   instance can run.
8. **Component tests and an automated accessibility audit** to close the stated gaps in
   `TESTING.md`.
9. **Razorpay**, only after 1–5.
10. **GymScan**, only with a model whose accuracy has been measured.

---

## Explicitly blocked

| Item | Blocked on |
| --- | --- |
| Live payments | Credentials, webhook verification, consumer disclosures, legal review |
| Wearable sync | Platform entitlements and a native shell |
| Publishing content as professionally reviewed | A named qualified reviewer and an audit trail |
| Claiming any compliance certification | An actual audit |
| Trainer marketplace | Qualification verification procedures |
