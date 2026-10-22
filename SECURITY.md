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
| Export | Full JSON export excludes the password hash, and is scoped to the requesting user. |
| Deletion | Hard delete across every table, including rows reachable only through a join. Verified by an orphan check in `tests/integration/privacy.test.ts`. |

## Response headers

Set in `next.config.ts` for every route:

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: camera=(self), microphone=(), geolocation=()
```

## Red-team review

What was examined, and what was found:

| Area | Result |
| --- | --- |
| Broken authentication | Identical failure responses; rate limited per account and per IP; no user enumeration via timing. |
| Session handling | Only hashes stored; expiry and revocation enforced on read; password change invalidates other sessions. |
| Cross-user data leakage | **Found and fixed during development**: none remaining. Covered by a dedicated integration suite and a browser test that confirms a second account gets a 404 on another user's session URL. |
| Insecure direct object references | All id-taking functions require the acting user; tested exhaustively. |
| Export vulnerabilities | Scoped by user id; excludes the password hash. |
| File uploads | None exist, so no upload surface. |
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
