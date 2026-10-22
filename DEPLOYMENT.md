# Deployment

## Honest summary

This build runs correctly on a single machine with a local SQLite file. It is **not
ready for public deployment**, and the gaps are infrastructural and legal, not cosmetic.

## Running it as-is

```bash
npm ci
npm run build
npm run setup          # first run only
NODE_ENV=production GYMOS_IP_SALT="<long random value>" npm start
```

Serves on port 3100. Put a TLS-terminating reverse proxy in front of it.

## Why SQLite cannot simply be deployed to serverless

The directive is right to warn about this, and GymOS does not pretend otherwise:

- Serverless functions have **ephemeral filesystems**. A SQLite file written during a
  request is gone afterwards.
- Multiple instances each get their **own copy**, so writes diverge silently.
- SQLite's locking model assumes a single machine.

So there are exactly three honest options:

1. **Single long-running instance with a persistent volume** (a VM or a container with a
   mounted disk). Simplest, and genuinely fine for a small deployment. Needs backups.
2. **libSQL / Turso** — the client is a near drop-in for the Drizzle SQLite driver and
   the schema needs no changes.
3. **PostgreSQL** — the schema was designed for this.

## Moving to PostgreSQL

The schema already avoids SQLite-only constructs, so the work is mechanical:

| Already done | Still required |
| --- | --- |
| Text ids (UUID/slug), not autoincrement | Swap `drizzle-orm/better-sqlite3` for `drizzle-orm/node-postgres` |
| ISO-8601 UTC timestamp strings | Change `sqliteTable` to `pgTable` and the column builders |
| Integer paise for money, integer grams for load | JSON columns become `jsonb` |
| Foreign keys with explicit cascade behaviour | Booleans become real `boolean` |
| Unique indexes for idempotency | Regenerate migrations with `drizzle-kit` |
| No raw SQL with string interpolation | Make the services `async` — SQLite is synchronous, Postgres is not |

That last row is the real work: every service function is currently synchronous. The call
sites already `await` through Server Actions, so the change is mostly mechanical, but it
touches every service file and should be done in one pass with the tests as a safety net.

## What production needs that this build does not have

### Blocking — must exist before real users

1. **Backups and restore**, with a stated retention policy and a tested restore.
2. **TLS**, via a reverse proxy or platform.
3. **A real `GYMOS_IP_SALT`.** The default is shared across installs.
4. **Email provider**, which unlocks verification, password reset and a contact route.
   Without it, a user who forgets their password cannot recover their account.
5. **Legal review** against the relevant data-protection regime (GDPR, India's DPDP Act,
   and specifically children's-data rules, since GymOS supports under-13 accounts). This
   is not optional for a product that supports minors.
6. **Professional content review.** Exercise and recipe instructions are internal drafts.
   Publishing them as professional guidance without review would be the most
   consequential dishonesty this product could commit.
7. **An independent security review.** See `SECURITY.md` for the residual risks.

### Important

8. **Error tracking and structured logging** — neither exists; logs are whatever the
   process prints.
9. **Health check endpoint** for a load balancer.
10. **A Content-Security-Policy with nonces** (see `SECURITY.md` residual risk 2).
11. **Shared-store rate limiting** if more than one instance runs.
12. **Migration strategy** — `scripts/migrate.ts` is idempotent and tracks applied files,
    but there is no rollback path.

### Before enabling payments

13. Razorpay credentials, **verified webhooks**, idempotent subscription updates, a
    working cancellation path, invoice records and consumer disclosures.

## Operational notes

- The database file needs a durable, backed-up volume. WAL mode means `-wal` and `-shm`
  files sit alongside it; back up all three, or use SQLite's backup API.
- `npm run db:migrate` is safe to run on every deploy; it skips already-applied files.
- `npm run db:seed` is idempotent and refreshes the content library. Run it after any
  content change.
- There are no background jobs, no queues and no cron dependencies.
- The service worker caches only the app shell and public content pages. Bump the `CACHE`
  constant in `public/sw.js` when those change materially.

## What will NOT work if you deploy this to a stateless platform today

- Every write will be lost between requests.
- Users will appear to register successfully and then not exist.
- Logged workouts will vanish.

If you deploy it anyway, deploy it to one instance with a disk.
