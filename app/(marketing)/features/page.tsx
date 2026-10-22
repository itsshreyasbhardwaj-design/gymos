import type { Metadata } from 'next';
import { Badge, Card, Notice, PageHeader, Section } from '@/components/ui';
import { EXERCISE_CATALOG } from '@/lib/content/exercises';
import { RECIPE_CATALOG } from '@/lib/content/recipes';
import { EQUIPMENT_CATALOG, EQUIPMENT_CATEGORY_LABELS } from '@/lib/content/equipment';

export const metadata: Metadata = {
  title: 'Features',
  description: 'Every GymOS capability, with an honest status for each one.',
};

type Status = 'working' | 'partial' | 'architecture' | 'not_implemented';

const STATUS_LABEL: Record<Status, { label: string; tone: 'ok' | 'warn' | 'neutral' | 'bad' }> = {
  working: { label: 'Working', tone: 'ok' },
  partial: { label: 'Partial', tone: 'warn' },
  architecture: { label: 'Architecture only', tone: 'neutral' },
  not_implemented: { label: 'Not implemented', tone: 'bad' },
};

const GROUPS: { group: string; items: { name: string; status: Status; detail: string }[] }[] = [
  {
    group: 'Accounts and onboarding',
    items: [
      { name: 'Email and password accounts', status: 'working', detail: 'scrypt password hashing, server-managed sessions, HTTP-only cookies, session revocation and rate limiting.' },
      { name: 'Nine-step onboarding', status: 'working', detail: 'Profile, experience, interests, availability, environment, equipment, nutrition preferences, review, first plan.' },
      { name: 'Age-appropriate experience', status: 'working', detail: 'Under-13 and 13-17 accounts get different programming rules, exercise filtering and nutrition behaviour, enforced on the server.' },
    ],
  },
  {
    group: 'Equipment DNA',
    items: [
      { name: 'Structured equipment catalog', status: 'working', detail: `${EQUIPMENT_CATALOG.length} equipment types across ${Object.keys(EQUIPMENT_CATEGORY_LABELS).length} categories, with "implies" relationships (a power rack provides a squat rack).` },
      { name: 'Multiple equipment profiles', status: 'working', detail: 'Home, gym, travel and custom locations, each with its own inventory and an active profile.' },
      { name: 'Compatibility engine', status: 'working', detail: 'Every exercise declares any-of requirement groups. The generator never assigns equipment you do not have.' },
      { name: 'Custom equipment entries', status: 'working', detail: 'Add items the catalog does not cover.' },
      { name: 'GymScan photo recognition', status: 'not_implemented', detail: 'No vision model ships with GymOS. Equipment set-up is search, browse and select, with a clean boundary where recognition would plug in.' },
    ],
  },
  {
    group: 'Exercise library',
    items: [
      { name: `${EXERCISE_CATALOG.length} exercises`, status: 'working', detail: 'Movement pattern, muscles, equipment groups, experience level, set-up, steps, cues, safety notes, substitutes, progressions and regressions.' },
      { name: 'Search and filtering', status: 'working', detail: 'By name, muscle, movement pattern, equipment, experience level and what your profile can actually do.' },
      { name: 'Professional review', status: 'partial', detail: 'Instructions are an internal draft. Every exercise carries a review status and is labelled "draft" until a qualified professional signs it off through the admin queue.' },
      { name: 'Demonstration video', status: 'not_implemented', detail: 'No licensed media ships. Media records exist with a placeholder status; nothing claims a demonstration is present.' },
    ],
  },
  {
    group: 'WorkoutOS',
    items: [
      { name: 'Deterministic generator', status: 'working', detail: 'Seeded and reproducible. Split selection, pattern templates, equipment filtering, scoring, time fitting and a written rationale per exercise.' },
      { name: 'Programming rules', status: 'working', detail: 'Sets, reps and rest come from versioned rules by age band and experience. Intensity never escalates without positive feedback.' },
      { name: 'Plan editing', status: 'working', detail: 'Replace, remove, add, re-dose. Every change re-checks equipment and safety constraints.' },
      { name: 'Transparent gaps', status: 'working', detail: 'When no exercise can cover a movement pattern, GymOS says so and names the cheapest way to unlock it, rather than inventing an equivalent.' },
    ],
  },
  {
    group: 'GuidedMode',
    items: [
      { name: 'Exercise-by-exercise session player', status: 'working', detail: 'Large controls, rest timer, quick logging, mid-session swaps, notes, discomfort reporting.' },
      { name: 'Crash-safe progress', status: 'working', detail: 'Every set is written to the server as you log it, and logging is idempotent — a refresh or a double-tap cannot duplicate a set.' },
      { name: 'Session summary and feedback', status: 'working', detail: 'Difficulty, recovery, enjoyment and discomfort, which feed the next session.' },
    ],
  },
  {
    group: 'RealitySync',
    items: [
      { name: 'Equipment change', status: 'working', detail: 'Re-maps the session onto a different profile, preserving movement patterns where a real equivalent exists.' },
      { name: 'Less time', status: 'working', detail: 'Builds a genuinely shorter session: accessories first, then rest, then sets. Never the same session rushed.' },
      { name: 'Missed session', status: 'working', detail: 'Moves it to a free day or lets it go. Never doubles another session.' },
      { name: 'Equipment occupied', status: 'working', detail: 'Swaps only the affected exercises, or lets you skip.' },
      { name: 'Session too hard', status: 'working', detail: 'Conservative volume reduction. Reported discomfort always reduces, never escalates.' },
      { name: 'Travel and schedule change', status: 'working', detail: 'Profile switch and day remapping, with completed history untouched.' },
      { name: 'Explainable adaptation', status: 'working', detail: 'Every proposal lists what changed, why, which inputs were used and whether equipment requirements are satisfied. Accept, modify or reject.' },
      { name: 'Plan versioning', status: 'working', detail: 'Revisions are recorded. Completed workouts are never rewritten.' },
    ],
  },
  {
    group: 'NutritionOS',
    items: [
      { name: `${RECIPE_CATALOG.length} recipes`, status: 'working', detail: 'Bengali, North Indian, South Indian, everyday home cooking and selected international, across vegetarian, vegan, egg-inclusive and non-vegetarian.' },
      { name: 'Allergen filtering', status: 'working', detail: 'Allergens are derived from ingredients, including optional ones, and applied as a hard filter on generation AND on every swap.' },
      { name: 'Meal planner', status: 'working', detail: 'Breakfast, lunch, dinner and optional snacks, with variety constraints, time limits and cooking skill.' },
      { name: 'Grocery and pantry', status: 'working', detail: 'Consolidated lists, unit-aware aggregation, pantry subtraction, shareable read-only lists, pantry-based suggestions.' },
      { name: 'Nutritional analysis', status: 'not_implemented', detail: 'No calorie or macro data ships, because none of it is sourced. Recipes show no nutrition panel rather than an invented one.' },
      { name: 'Grocery cost estimates', status: 'partial', detail: 'GymOS ships with no retail price data. Totals come only from prices you record yourself, and the list says how many items are covered.' },
    ],
  },
  {
    group: 'FitBrain',
    items: [
      { name: 'Guided assistant', status: 'working', detail: 'Rule-based intent routing over your own records and the content libraries. Eleven capabilities, all answers computed rather than generated.' },
      { name: 'Preference memory', status: 'working', detail: 'Favourites and dislikes feed the generator. You can inspect and delete anything it remembers.' },
      { name: 'Safety boundaries', status: 'working', detail: 'Injury, medical and appearance questions are redirected, not answered. It cannot bypass the planning engines.' },
      { name: 'Language-model answers', status: 'not_implemented', detail: 'No model is connected and no API key is required. A provider interface exists; even when filled it could only rephrase an answer the rules already produced.' },
    ],
  },
  {
    group: 'ProgressOS and biometrics',
    items: [
      { name: 'Training analytics', status: 'working', detail: 'Weekly sessions, sets, volume and consistency, muscle balance and personal milestones — all from your own logged sets.' },
      { name: 'Activity records', status: 'working', detail: 'Walks, cycles, sports and other activity, entered by you.' },
      { name: 'Optional biometrics', status: 'working', detail: 'Steps, sleep, resting heart rate, body mass and self-reported recovery — consent-gated, deletable, never required, and never used to claim an "ideal" intensity.' },
      { name: 'Wearable import', status: 'architecture', detail: 'HealthKit and Health Connect have a data shape and a consent record. Nothing is connected.' },
    ],
  },
  {
    group: 'Platform',
    items: [
      { name: 'Entitlements', status: 'working', detail: 'Free and Pro limits enforced server-side on every write path, not just hidden in the interface.' },
      { name: 'Payments', status: 'architecture', detail: 'Razorpay has an integration boundary. No credentials, no checkout, no fake success screens.' },
      { name: 'Data export and deletion', status: 'working', detail: 'Full JSON export and hard account deletion, available on every plan.' },
      { name: 'Installable PWA', status: 'working', detail: 'Manifest and a scoped service worker that caches the app shell and public exercise pages you have visited.' },
      { name: 'Offline sync', status: 'not_implemented', detail: 'Logging a workout needs a connection. GymOS does not claim offline write sync it does not have.' },
      { name: 'Gym partner portal', status: 'architecture', detail: 'Venue and verified-inventory tables exist with a review status. No multi-tenant portal.' },
      { name: 'Trainer and community features', status: 'not_implemented', detail: 'Consent records and authorization boundaries exist; no trainer accounts and no social features.' },
    ],
  },
];

export default function FeaturesPage() {
  const counts = GROUPS.flatMap((g) => g.items).reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-4xl px-4 py-14">
      <PageHeader
        eyebrow="Feature inventory"
        title="Everything GymOS does, and what it does not"
        description="Most feature pages are a wish list. This one is generated from the implementation status of each capability, so a feature that is not finished says so."
      />
      <div className="flex flex-wrap gap-2 mb-8">
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <Badge key={s} tone={STATUS_LABEL[s].tone}>
            {STATUS_LABEL[s].label}: {counts[s] ?? 0}
          </Badge>
        ))}
      </div>

      <div className="space-y-10">
        {GROUPS.map((group) => (
          <Section key={group.group} title={group.group}>
            <div className="space-y-2">
              {group.items.map((item) => (
                <Card key={item.name} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-[var(--text-muted)] mt-1 leading-relaxed">
                        {item.detail}
                      </p>
                    </div>
                    <Badge tone={STATUS_LABEL[item.status].tone} className="shrink-0">
                      {STATUS_LABEL[item.status].label}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          </Section>
        ))}
      </div>

      <Notice tone="neutral" className="mt-10">
        This page is maintained alongside the code. If something here is wrong, the honest fix is
        to change the status, not the wording.
      </Notice>
    </div>
  );
}
