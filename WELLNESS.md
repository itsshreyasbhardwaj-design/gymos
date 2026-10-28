# Personal wellness modules

Photo journal · Skincare & grooming · Style · Voice & communication · Hygiene · Review

These sit inside GymOS as connected parts of one app, not as separate tools. They share
its accounts, authorization, entitlements, consent records, data export and account
deletion, and they appear in the same navigation, the same Today page and the same
assistant.

---

## The constraints that shaped every one of them

This section is first because it explains why these modules look the way they do, and
because a feature list that omits it would be misleading.

### There is no appearance scoring, anywhere

GymOS does not and will not:

- score facial features or assign a beauty or attractiveness rating,
- rank body proportions or grade body shape,
- estimate body-fat percentage from a photograph,
- compare you against an idealised body, or against another person,
- produce a negative judgement about how you look, or suggest changing a physical trait,
- recognise identity from a face or a voice.

This is enforced in three places rather than only promised in prose:

1. **The schema has no column that could hold such a value.** No `score`, no `rating`,
   no `attractiveness`, no estimated body composition from media. A feature like this
   could not be added without a migration.
2. **`tests/unit/journal-safety.test.ts` scans the exported schema programmatically** and
   fails if a column whose name suggests an appearance score appears. It is a guard
   against a later change, not a one-off check.
3. **FitBrain routes the question to a refusal with its own copy** (`appearance_redirect`),
   which says plainly that the app does not do this and offers what it can do instead.

### There is no speech recognition, so nothing is transcribed

No speech model ships, and none is called over the network. GymOS therefore reports
only what can honestly be measured from a recording, plus what you tell it yourself:

| Figure | Source | Honest? |
| --- | --- | --- |
| Duration | The recorded buffer | Measured |
| Pause count, longest pause, speaking ratio | RMS energy analysis of the real audio in your browser | Measured |
| Words per minute | Script word count ÷ measured duration | Measured **only** when you read one of the practice scripts |
| Filler-word tally | You tapping a counter during playback | Self-reported, and labelled as such |
| Clarity | Your own rating | Self-reported |

`communication_feedback.source` is a column with exactly two values, `measured` and
`self_reported`. The distinction is in the data model, not just in the UI copy, so it
survives export and cannot be quietly blurred. If you practise without a script, the
pace figure is `null` — GymOS says it does not know rather than guessing.

### Nothing is diagnosed

No skin condition, no health condition, from a photograph or a description. A patch
test records what *you* observed and can only return `in_progress` until its window
closes; it never returns a dermatological verdict. Anything clinical is routed to "see
a qualified professional".

### Media capture is 18+ only

Storing a minor's face photographs or voice recordings carries consent requirements
this build cannot satisfy: there is no verified parental-consent mechanism and no legal
review. So it is refused at the service layer rather than collected under a consent a
child cannot meaningfully give. `assertMediaAgeEligible` runs before any byte is read.

Everything else — grooming, hygiene, wardrobe, reviews, and speaking practice *without*
recording — is fully available to under-18 accounts.

### Every core feature works without uploading anything

Workouts, nutrition, progress, the wardrobe, routines, practice scripts and the review
all function with both media consents off and no file ever uploaded. Pages explain that
state rather than breaking in it.

---

## Privacy architecture

### How a private file is stored

```
upload  →  age check  →  consent check  →  entitlement check  →  type + size check
        →  metadata stripped  →  AES-256-GCM sealed  →  written 0600 outside the served tree
```

Order matters. The checks run before anything is read, and the metadata is removed
*before* encryption, so the plaintext that existed on the way to disk never contained
it either.

| Property | How |
| --- | --- |
| Encrypted at rest | AES-256-GCM, a fresh 96-bit IV per file, auth tag stored alongside. `lib/media/crypto.ts` |
| No public URL | Files live under `GYMOS_MEDIA_PATH` (default `data/media`), outside `public/`. The only reader is `GET /api/media/[id]`, which authenticates and checks ownership before decrypting. |
| Metadata stripped | Real parsing, zero dependencies. JPEG: every `APPn` (EXIF, XMP, IPTC) and `COM` segment dropped. PNG: allowlist of structural chunks. WebP: `EXIF`/`XMP ` chunks dropped and the RIFF size rewritten. MP3: ID3v2 and ID3v1 tags cut. `lib/media/strip-metadata.ts` |
| Honest about what it did | `metadata_stripped` means "went through a stripper that understands this format". A WebM recording from the in-app recorder has no metadata to remove — and also was not inspected, and the privacy screen says so rather than implying a clean-up happened. |
| Tamper-evident | A file altered on disk fails its GCM auth tag and is refused with `MediaIntegrityError`, never served half-decrypted. |
| Ownership in the SQL predicate | Owner, or an explicit, unexpired, unrevoked grant. There is no third path. |
| Indistinguishable refusals | "Not yours" and "does not exist" return the identical message, so probing ids reveals nothing. |
| Revocable sharing | Per-file grants with optional expiry, individually revocable plus a revoke-all — the *revoke* half, built and tested. **No control in this build creates a share**, so nothing can currently be shared at all. Creating one would mean looking another account up by email, which would leak whether that account exists, so it is deferred rather than guessed at. The screen says this plainly instead of implying a sharing feature. |
| Real deletion | The encrypted file is removed from disk, the row is deleted, and a `media_deletion_events` row records the reason, bytes freed and **whether the file actually went**. "Deleted" is checkable rather than claimed. |
| Destructive consent withdrawal | Turning off `photo_journal` or `voice_recording` deletes every file collected under it immediately, inside `setConsent`. The toggle and the data cannot drift apart. |
| Account deletion | `deleteAllMedia` runs before the database transaction, then the per-user directory is removed. |
| No advertising, no training | Media is never used for either. There is no third party to send it to in this build. |
| Response hardening | `private, no-store`, `nosniff`, `Referrer-Policy: no-referrer`, and `Content-Security-Policy: default-src 'none'; sandbox` — so even unexpected bytes cannot execute or call out. |

### Honest about the key

With no `GYMOS_MEDIA_KEY` set, GymOS generates a random per-install key and stores it
at `data/media/.media-key` (mode `0600`). This is fine on your own machine and is **not**
production key management, so `isDevelopmentKey()` reports it, the media-privacy screen
shows it, FitBrain mentions it, and the data export states which mode is in use. The app
does not quietly imply a managed key it does not have.

### Uploads use a route handler, not a Server Action

Server Actions buffer the whole body into the action payload. `POST /api/media` reads
the file once and hands the bytes straight to the service. It is guarded by
`assertSameOriginStrict`, which — unlike the JSON gate used elsewhere — insists on
positive same-origin proof, because `multipart/form-data` is a CORS-simple content type
that a cross-site form can post without a preflight.

---

## The modules

### Photo journal and check-ins — `/wellness`, `/wellness/journal`, `/wellness/check-ins`

A private, dated record of your own photographs and notes. Check-ins are **opt-in**: the
cadence column defaults to `off`, and can be set back to `off` at any time. Comparison
is side-by-side with dates and nothing computed. The only "analysis" is your own note.

### Skincare and grooming — `/grooming`, `/grooming/routines`, `/skincare`

Routines with ordered steps and day-of-week scheduling; product inventory with expiry
and period-after-opening tracking; a skin journal; patch tests with a conservative
verdict; appointments. Adherence is reported as plain counts with neutral wording — no
score, no grade, no streak to break.

### Style — `/wardrobe`, `/wardrobe/outfits`, `/wardrobe/planner`

A digital wardrobe and an outfit engine that works entirely offline, with no shopping
API and nothing to buy. Suggestions are scored on **colour harmony, formality match and
weather suitability only**, and each one carries a readable explanation of why it works.
There are deliberately no body-shape rules and no "flattering"/"slimming" logic: the
engine has no notion of a body to flatter. Wardrobe gaps are phrased as facts about the
wardrobe, never as a deficiency of the person.

### Voice and communication — `/voice`, `/voice/practice`, `/voice/history`

Goals, a library of original practice scripts with known word counts, in-browser
recording and playback, and the honestly measurable metrics in the table above.
Practice works without recording at all, which is also what under-18 accounts get.

### Hygiene — `/hygiene`

Routines with ordered tasks and three cadences (daily, weekly, every *n* days), due-task
computation from the last check-in, and supply tracking with restock flags. No
cleanliness score and no guilt copy for a missed day — both are explicit rules in the
engine, with tests.

### Unified review — `/reviews`

One report across training, food, grooming, wardrobe, voice, hygiene and journal, for a
week, fortnight, month or on request, with selectable sections.

Two rules govern every string the generator produces:

1. **No shaming.** A week with nothing in it is a week with nothing in it. The review
   never implies you let yourself down, and `tests/unit/review.test.ts` asserts the
   absence of shaming and grading vocabulary across the worst-looking inputs it can
   construct (everything planned, nothing done).
2. **No invention.** A module with no rows for the window says so plainly rather than
   manufacturing an insight.

It also states its own limits in the UI: every number comes from something you
recorded, it never reads your photographs or recordings, and it is not a health
assessment.

### FitBrain

Five new capabilities (review overview, what is due, outfit help, speaking practice,
media privacy) and three new refusals with copy written for them:

| Asked | Routed to |
| --- | --- |
| "rate my face", "am i attractive", "estimate my body fat from this photo" | `appearance_redirect` |
| "is this acne", "what is this rash", "what cream should i use for this" | `skin_concern_redirect` |
| "is my voice good", "transcribe my recording", "what did i say" | `voice_judgement_redirect` |

The appearance wording was **moved out of** the general safety redirect so the answer is
specific to the question rather than a deflection about injuries. Still no language
model: every answer is computed by deterministic code from your own rows.

---

## Entitlements

Private media, the wardrobe and care routines have plan limits sized by storage and
clutter, not used as leverage:

| Feature | Free | Pro |
| --- | --- | --- |
| Private files (photo + audio) | 25 | 500 |
| Wardrobe items | 40 | Unlimited |
| Care routines (grooming + hygiene combined) | 4 | Unlimited |

The journal itself is free, and the rights over your data — export, deletion, the
deletion log — are never gated.

---

## Data model

27 tables, all in `lib/db/schema.ts`, migration `drizzle/0002_robust_otto_octavius.sql`.

| Area | Tables |
| --- | --- |
| Media | `private_media_assets`, `media_access_grants`, `media_deletion_events` |
| Journal | `personal_journal_entries`, `photo_checkins`, `photo_checkin_assets`, `checkin_schedules` |
| Grooming | `grooming_routines`, `grooming_routine_steps`, `grooming_routine_logs`, `grooming_appointments` |
| Skincare | `skincare_products`, `skincare_journal`, `patch_tests` |
| Style | `wardrobe_items`, `outfit_combinations`, `outfit_plans` |
| Voice | `communication_goals`, `voice_practice_sessions`, `voice_recordings`, `communication_feedback` |
| Hygiene | `hygiene_routines`, `hygiene_tasks`, `hygiene_checkins`, `personal_care_supplies` |
| Review | `personal_review_reports`, `review_preferences` |

Two consent kinds were added, `photo_journal` and `voice_recording`, each gating exactly
one kind of sensitive media and each independently revocable — destructively.

---

## Export and deletion

Both were extended, and both are tested:

- **Export** covers all 27 tables, including the five child tables whose only link to
  you is a parent id (`photo_checkin_assets`, `grooming_routine_steps`, `hygiene_tasks`,
  `voice_recordings`, `communication_feedback`).
- **Media files are deliberately not embedded** in the JSON — it is stored as a database
  row, and base64 media would multiply its size for no gain. The export says so, lists
  every file, and points at the download screen. It strips `ivHex`, `authTagHex` and
  `storagePath`, which would weaken the files if exported.
- **Deletion** removes the encrypted files from disk first, then the child rows, then the
  parents, and `tests/integration/privacy.test.ts` asserts no orphan survives in any of
  the new child tables.
