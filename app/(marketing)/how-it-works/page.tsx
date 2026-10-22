import type { Metadata } from 'next';
import { Card, LinkButton, Notice, PageHeader, Section, BulletList } from '@/components/ui';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'From your equipment list to a plan that adapts when your week changes.',
};

const STEPS = [
  {
    n: '01',
    title: 'Tell GymOS what you have',
    body: 'Pick a starting preset and then adjust item by item — a pull-up bar, two pairs of dumbbells, a leg press. You can keep several profiles: home, gym, travel.',
  },
  {
    n: '02',
    title: 'Set your week',
    body: 'Which days, how long, how flexible. Plus your experience, what you want out of training, and anything that feels sensitive right now.',
  },
  {
    n: '03',
    title: 'Get a plan built from your inventory',
    body: 'Movement patterns are chosen first, then the best exercise you can actually do for each one. Sets, reps and rest come from the programming rules for your age band and experience.',
  },
  {
    n: '04',
    title: 'Train with GuidedMode',
    body: 'One exercise at a time, big buttons, a rest timer, and logging that saves as you go. Swap an exercise mid-session if a machine is taken.',
  },
  {
    n: '05',
    title: 'Let RealitySync handle the week you actually had',
    body: 'Only twenty minutes? At home instead of the gym? Missed Monday? RealitySync proposes a change, shows its reasoning, and waits for you to accept.',
  },
  {
    n: '06',
    title: 'Plan food the same way',
    body: 'Set your diet, allergens and how long you want to spend cooking. Swap any meal; the grocery list follows.',
  },
];

const SCENARIOS = [
  {
    title: 'Different equipment',
    body: 'You switch from the commercial gym profile to Home. Lat pulldown has no equivalent with a band alone? GymOS says so instead of pretending.',
  },
  {
    title: 'Less time than planned',
    body: 'Accessories go first, then rest comes down, then sets. The main lift survives. You get a shorter session, not a rushed one.',
  },
  {
    title: 'Missed a workout',
    body: 'It moves to the next free day if there is one, or it is simply let go. Nothing is added to another day to compensate.',
  },
  {
    title: 'Machine occupied',
    body: 'Only that exercise changes. You can also skip it — nothing is recorded as a failure.',
  },
  {
    title: 'The session was too hard',
    body: 'Volume comes down and rest goes up. If you reported discomfort, GymOS reduces and tells you to see a professional. It does not guess why.',
  },
  {
    title: 'Travelling',
    body: 'Switch to your travel profile and the week re-plans around a band and a hotel room.',
  },
  {
    title: 'Your days changed',
    body: 'Upcoming sessions move onto your new days. Completed sessions stay exactly where they are.',
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 space-y-14">
      <PageHeader
        eyebrow="How it works"
        title="Plan around the week you actually have"
        description="GymOS makes one bet: the reason plans fail is rarely motivation. It is that the plan assumed a gym, ninety minutes and a Tuesday that went as expected."
      />

      <Section title="Getting set up">
        <ol className="grid gap-3 sm:grid-cols-2">
          {STEPS.map((s) => (
            <li key={s.n}>
              <Card className="p-5 h-full">
                <span className="text-xs font-mono text-[var(--accent-2)]">{s.n}</span>
                <h3 className="font-semibold mt-2">{s.title}</h3>
                <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">{s.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="The seven things RealitySync handles"
        description="Each one produces a proposal you can read, change or reject. Nothing is applied silently."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {SCENARIOS.map((s) => (
            <Card key={s.title} className="p-5">
              <h3 className="font-semibold text-sm">{s.title}</h3>
              <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">{s.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="What every adaptation shows you">
        <Card className="p-5">
          <BulletList
            items={[
              'What changed — exercise by exercise, with the original and the replacement.',
              'Why it changed — the specific equipment or constraint that triggered it.',
              'Which of your information was considered — equipment profile, experience, age band, stated limitations, your own history.',
              'Whether the replacement’s equipment requirements are actually satisfied.',
              'Alternatives, so you can pick a different swap.',
              'A way to reject or revert it.',
            ]}
          />
        </Card>
      </Section>

      <Notice tone="warn" title="What it will not do">
        GymOS will not tell you a push-up replaces a lat pulldown. It will not double a session to
        punish a missed day. It will not rewrite a workout you already finished. And it will not
        tell you whether a sore shoulder is safe to train — that is a question for a qualified
        professional.
      </Notice>

      <div className="flex flex-wrap gap-3">
        <LinkButton href="/signup" size="lg">
          Build My Fitness Plan
        </LinkButton>
        <LinkButton href="/equipment-intelligence" variant="secondary" size="lg">
          How equipment matching works
        </LinkButton>
      </div>
    </div>
  );
}
