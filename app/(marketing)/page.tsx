import Link from 'next/link';
import {
  Dumbbell,
  RefreshCw,
  CalendarDays,
  UtensilsCrossed,
  Brain,
  LineChart,
  ShieldCheck,
  CircleCheck,
  CircleAlert,
} from 'lucide-react';
import { Badge, Card, LinkButton, Notice, Section } from '@/components/ui';
import { PlanPreview } from '@/components/plan-preview';
import { EXERCISE_CATALOG } from '@/lib/content/exercises';
import { RECIPE_CATALOG } from '@/lib/content/recipes';
import { EQUIPMENT_CATALOG } from '@/lib/content/equipment';
import { PRICING, BILLING_STATUS } from '@/lib/engines/entitlements';

const SYSTEMS = [
  {
    icon: Dumbbell,
    name: 'Equipment DNA',
    blurb:
      'A structured inventory of what you can actually train with — at home, at the gym, in a hotel room. Every exercise declares exactly what it needs.',
    href: '/equipment-intelligence',
  },
  {
    icon: RefreshCw,
    name: 'RealitySync',
    blurb:
      'Different equipment, less time, a missed day, a machine in use. RealitySync re-plans the session and shows you exactly what it changed and why.',
    href: '/how-it-works',
  },
  {
    icon: CalendarDays,
    name: 'WorkoutOS',
    blurb:
      'A deterministic planner, not a chatbot. Movement patterns, sets, reps and rest come from reviewed programming rules for your age band and experience.',
    href: '/workout-planning',
  },
  {
    icon: UtensilsCrossed,
    name: 'NutritionOS',
    blurb:
      'Flexible, balanced meal suggestions with an India-first recipe library. Declared allergens are a hard filter, never a suggestion.',
    href: '/nutrition-planning',
  },
  {
    icon: Brain,
    name: 'FitBrain',
    blurb:
      'A guided assistant that explains your plan, finds compatible exercises and remembers what you like — answering from your own records.',
    href: '/features',
  },
  {
    icon: LineChart,
    name: 'ProgressOS',
    blurb:
      'Your own sets, holds and sessions, charted. No body-composition predictions, no comparisons with other people, no guilt about a missed week.',
    href: '/features',
  },
];

export default function HomePage() {
  const equipmentCount = EQUIPMENT_CATALOG.filter((e) => e.id !== 'none').length;
  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,var(--accent-soft),transparent_70%)]"
        />
        <div className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:pt-24 sm:pb-16 text-center">
          <Badge tone="teal" className="mb-5">
            Equipment DNA + RealitySync
          </Badge>
          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05] max-w-3xl mx-auto">
            Fitness that fits real life.
          </h1>
          <p className="mt-5 text-lg text-[var(--text-muted)] max-w-2xl mx-auto leading-relaxed">
            Personalized workouts for your equipment, flexible meal planning, and an adaptive
            fitness routine that changes when your life does.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <LinkButton href="/signup" size="lg">
              Build My Fitness Plan
            </LinkButton>
            <LinkButton href="/how-it-works" variant="secondary" size="lg">
              See How GymOS Works
            </LinkButton>
          </div>
          <p className="mt-6 text-sm text-[var(--text-muted)]">
            One app. Your equipment. Your workouts. Your meals. Your progress.
          </p>
          <dl className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl mx-auto">
            {[
              { label: 'Exercises in the library', value: EXERCISE_CATALOG.length },
              { label: 'Equipment types tracked', value: equipmentCount },
              { label: 'Recipes, India-first', value: RECIPE_CATALOG.length },
              { label: 'API keys you need', value: 0 },
            ].map((stat) => (
              <div key={stat.label} className="surface p-4">
                <dd className="text-2xl font-semibold tabular-nums">{stat.value}</dd>
                <dt className="text-xs text-[var(--text-muted)] mt-1 leading-snug">{stat.label}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------------- preview */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            Try the planner before you sign up
          </h2>
          <p className="text-[var(--text-muted)] mt-2 max-w-2xl mx-auto">
            Pick what you have and how long you have got. This runs the same engine that builds
            real plans — including telling you when a movement pattern genuinely cannot be covered.
          </p>
        </div>
        <PlanPreview />
      </section>

      {/* ------------------------------------------------------------- systems */}
      <section className="mx-auto max-w-6xl px-4 py-16 border-t border-[var(--border)]">
        <Section
          title="Six systems, one data model"
          description="GymOS is not six separate dashboards. The equipment you own decides which exercises exist for you; the sessions you log feed the next plan; a swapped meal changes the grocery list."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SYSTEMS.map((s) => {
              const Icon = s.icon;
              return (
                <Card key={s.name} className="p-5 hover:border-[var(--border-strong)] transition-colors">
                  <div className="h-10 w-10 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] grid place-items-center mb-4">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="font-semibold">{s.name}</h3>
                  <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">{s.blurb}</p>
                  <Link
                    href={s.href}
                    className="text-sm text-[var(--accent)] mt-3 inline-block hover:underline"
                  >
                    Learn more →
                  </Link>
                </Card>
              );
            })}
          </div>
        </Section>
      </section>

      {/* --------------------------------------------------------- the scenario */}
      <section className="mx-auto max-w-6xl px-4 py-16 border-t border-[var(--border)]">
        <Section
          title="The twenty-minute Tuesday"
          description="This is the case GymOS is built around — the one most fitness apps hand back to you unchanged."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <Badge tone="neutral" className="mb-3">
                What happened
              </Badge>
              <p className="text-sm leading-relaxed">
                You normally train at a commercial gym. Today you are at home with a pair of
                dumbbells, a band and twenty minutes before a call.
              </p>
            </Card>
            <Card className="p-5">
              <Badge tone="brand" className="mb-3">
                What GymOS does
              </Badge>
              <ul className="text-sm space-y-2 leading-relaxed">
                <li>Switches to your Home equipment profile.</li>
                <li>Keeps the squat and the press; swaps the lat pulldown for a band row.</li>
                <li>Drops the accessory work rather than rushing everything.</li>
                <li>Shows you the swap, the reason, and the alternatives.</li>
              </ul>
            </Card>
            <Card className="p-5">
              <Badge tone="teal" className="mb-3">
                What it will not do
              </Badge>
              <ul className="text-sm space-y-2 leading-relaxed">
                <li>Claim a bodyweight move replaces a machine when it does not.</li>
                <li>Double tomorrow&apos;s session to make up for today.</li>
                <li>Quietly rewrite the workout you already finished.</li>
              </ul>
            </Card>
          </div>
        </Section>
      </section>

      {/* ------------------------------------------------------- honest status */}
      <section className="mx-auto max-w-4xl px-4 py-16 border-t border-[var(--border)]">
        <Section
          title="What this build actually does"
          description="Rather than a wall of claims, here is the honest state of GymOS. Anything not listed as working is not pretending to work."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-5">
              <p className="font-semibold text-sm mb-3 inline-flex items-center gap-2">
                <CircleCheck className="h-4 w-4 text-ok-500" aria-hidden="true" />
                Working now
              </p>
              <ul className="text-sm space-y-2 text-[var(--text-muted)] leading-relaxed">
                <li>Accounts, onboarding, persistence</li>
                <li>Equipment profiles and compatibility filtering</li>
                <li>Workout generation, editing and substitutions</li>
                <li>Guided logging with autosave and session history</li>
                <li>RealitySync adaptation with explanations</li>
                <li>Meal planning with hard allergen filtering</li>
                <li>Grocery lists and pantry tracking</li>
                <li>Progress analytics from your own logged sets</li>
                <li>Data export and account deletion</li>
              </ul>
            </Card>
            <Card className="p-5">
              <p className="font-semibold text-sm mb-3 inline-flex items-center gap-2">
                <CircleAlert className="h-4 w-4 text-warn-500" aria-hidden="true" />
                Not connected
              </p>
              <ul className="text-sm space-y-2 text-[var(--text-muted)] leading-relaxed">
                <li>
                  <strong>Payments.</strong> Razorpay has an integration boundary and nothing else.
                  No card can be charged.
                </li>
                <li>
                  <strong>Wearables.</strong> No HealthKit or Health Connect link exists.
                </li>
                <li>
                  <strong>Photo equipment recognition.</strong> Manual search and selection only;
                  no vision model ships.
                </li>
                <li>
                  <strong>Professional review.</strong> Exercise and recipe text is an internal
                  draft, labelled as such everywhere it appears.
                </li>
                <li>
                  <strong>Coaching and gym partner portals.</strong> Data model only.
                </li>
              </ul>
            </Card>
          </div>
          <Notice tone="neutral">
            <span className="inline-flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent-2)]" aria-hidden="true" />
              <span>
                GymOS gives general fitness information. It is not medical, physiotherapy or
                dietetic advice, it cannot diagnose anything, and it will never tell you to train
                through pain. Under-18 accounts get an age-appropriate experience with no
                restrictive nutrition tools and no appearance scoring.
              </span>
            </span>
          </Notice>
        </Section>
      </section>

      {/* -------------------------------------------------------------- pricing */}
      <section className="mx-auto max-w-5xl px-4 py-16 border-t border-[var(--border)]">
        <Section
          title="Simple plans"
          description="The free tier is genuinely usable on its own. Entitlements are enforced on the server, not hidden in the interface."
          action={
            <LinkButton href="/pricing" variant="secondary" size="sm">
              Full comparison
            </LinkButton>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {[PRICING.free, PRICING.pro].map((tier) => (
              <Card key={tier.name} className="p-6">
                <p className="font-semibold">{tier.name}</p>
                <p className="text-3xl font-semibold mt-2 tabular-nums">
                  ₹{(tier.pricePaise / 100).toLocaleString('en-IN')}
                  <span className="text-sm font-normal text-[var(--text-muted)]">/month</span>
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-2">{tier.blurb}</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {tier.includes.map((line) => (
                    <li key={line} className="flex gap-2">
                      <CircleCheck
                        className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent-2)]"
                        aria-hidden="true"
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          <Notice tone="warn">{BILLING_STATUS.message}</Notice>
        </Section>
      </section>

      {/* ------------------------------------------------------------ final cta */}
      <section className="mx-auto max-w-4xl px-4 py-20 text-center border-t border-[var(--border)]">
        <h2 className="text-3xl font-semibold tracking-tight">Start with what you have today</h2>
        <p className="text-[var(--text-muted)] mt-3 max-w-xl mx-auto">
          No equipment is a valid answer. So is a full commercial gym. GymOS plans around whichever
          is true this week.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <LinkButton href="/signup" size="lg">
            Build My Fitness Plan
          </LinkButton>
          <LinkButton href="/features" variant="ghost" size="lg">
            Browse every feature
          </LinkButton>
        </div>
      </section>
    </>
  );
}
