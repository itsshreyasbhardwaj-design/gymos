import type { Metadata } from 'next';
import { BulletList, Card, LinkButton, Notice, PageHeader, Section } from '@/components/ui';
import { MOVEMENT_PATTERN_LABELS } from '@/lib/content/exercise-types';
import { EXERCISE_CATALOG } from '@/lib/content/exercises';
import { PROGRAMMING_VERSION } from '@/lib/engines/programming';
import { GENERATOR_VERSION } from '@/lib/engines/workout-generator';

export const metadata: Metadata = {
  title: 'Workout planning',
  description: 'A deterministic, testable workout generator — not a language model guessing.',
};

export default function WorkoutPlanningPage() {
  const byPattern = Object.entries(MOVEMENT_PATTERN_LABELS).map(([id, label]) => ({
    id,
    label,
    count: EXERCISE_CATALOG.filter((e) => e.pattern === id).length,
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 space-y-14">
      <PageHeader
        eyebrow="WorkoutOS"
        title="A planner you can audit"
        description="GymOS does not ask a language model to invent your training. The generator is ordinary code: given the same inputs it produces the same plan, and every decision has a reason you can read."
      />

      <Section title="The twelve steps the generator takes">
        <Card className="p-5">
          <ol className="space-y-2.5 text-sm leading-relaxed list-decimal pl-5">
            <li>Validate the profile — without onboarding there is nothing to plan from.</li>
            <li>Read the training interests and the age band.</li>
            <li>Choose a realistic split for the number of days you actually picked.</li>
            <li>Lay out movement-pattern slots for each day, by role.</li>
            <li>Filter the whole library down to what your equipment supports.</li>
            <li>Apply suitability constraints: age band, experience, stated limitations.</li>
            <li>Remove anything you have told it you dislike.</li>
            <li>Score the remaining candidates, preferring loadable work for main slots and favourites where you have marked them.</li>
            <li>Avoid repeating the same exercise within a day, and vary across the week.</li>
            <li>Apply the programming rules for sets, reps, rest and intensity language.</li>
            <li>Fit the session to your minute budget — dropping accessories before shortening rest, and shortening rest before cutting sets.</li>
            <li>Write an explanation for the plan and a rationale for every exercise, then save it.</li>
          </ol>
        </Card>
        <p className="text-xs text-[var(--text-muted)]">
          Engine version <code className="font-mono">{GENERATOR_VERSION}</code>, programming rules{' '}
          <code className="font-mono">{PROGRAMMING_VERSION}</code>. Both are stored with every plan.
        </p>
      </Section>

      <Section
        title="Movement patterns in the library"
        description="Slots are filled by pattern first, so a plan stays balanced even when equipment is limited."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {byPattern.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            >
              <span className="truncate">{p.label}</span>
              <span className="tabular-nums text-[var(--text-muted)]">{p.count}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Age-appropriate programming">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-5">
            <p className="font-semibold text-sm">Under 13</p>
            <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
              Activity sessions only: movement practice, balance, play-paced conditioning. No load
              prescriptions, no intensity targets, and only exercises flagged suitable for children.
            </p>
          </Card>
          <Card className="p-5">
            <p className="font-semibold text-sm">13 to 17</p>
            <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
              Technique first. Moderate rep ranges, capped set counts, never training to failure,
              and a conservative experience level regardless of what is self-reported.
            </p>
          </Card>
          <Card className="p-5">
            <p className="font-semibold text-sm">18 and over</p>
            <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
              Standard ranges by experience, with rest scaled to how demanding the work actually is.
            </p>
          </Card>
        </div>
      </Section>

      <Section title="How feedback changes the next session">
        <Card className="p-5">
          <BulletList
            items={[
              'Reported discomfort always reduces volume and never escalates anything.',
              '"Too hard" or very poor recovery means fewer sets, a slightly narrower rep range and more rest.',
              '"Too easy" with good recovery adds one small increment — a rep or two, ten seconds, or a single set. Never more than one step at a time.',
              'Nothing escalates without positive feedback. Silence is not permission.',
              'Set counts stay capped for under-18 accounts whatever the feedback says.',
            ]}
          />
        </Card>
      </Section>

      <Notice tone="neutral" title="On the exercise instructions">
        The set-up, steps, cues and safety notes in the library are an internal draft written for
        GymOS from general resistance-training practice. They are labelled as drafts everywhere they
        appear and carry a review status, because presenting unreviewed text as professional
        coaching would be dishonest.
      </Notice>

      <div className="flex flex-wrap gap-3">
        <LinkButton href="/signup" size="lg">
          Generate my first plan
        </LinkButton>
        <LinkButton href="/nutrition-planning" variant="secondary" size="lg">
          Nutrition planning
        </LinkButton>
      </div>
    </div>
  );
}
