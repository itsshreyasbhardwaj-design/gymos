import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Straight answers about what GymOS does, stores and cannot do.',
};

const FAQS: { q: string; a: string }[] = [
  {
    q: 'Do I need any equipment to use GymOS?',
    a: 'No. "No equipment" is a valid profile and the library has a large bodyweight section. GymOS will also tell you honestly which movement patterns bodyweight cannot cover, and what the cheapest way to unlock them would be.',
  },
  {
    q: 'Is this an AI app?',
    a: 'Not in the way that phrase is usually used. There is no language model in this build and no API key is required. The planner, the adaptation engine and the assistant are ordinary deterministic code reading your records and a reviewed content library. FitBrain is a guided assistant, not a chatbot.',
  },
  {
    q: 'Can GymOS tell me if my shoulder pain is serious?',
    a: 'No, and it will not try. It cannot diagnose anything or tell you whether it is safe to train through a symptom. It can mark a sensitivity in your profile so plans stop including movements that load that area, and it will always point you to a qualified professional.',
  },
  {
    q: 'Are the exercise instructions written by professionals?',
    a: 'Not yet. They are an internal draft written for GymOS from general resistance-training practice. Every exercise carries a review status and is labelled "draft — awaiting review" until a qualified professional signs it off. The same goes for the recipes.',
  },
  {
    q: 'Does it show calories and macros?',
    a: 'No. GymOS ships with no sourced nutritional analysis, so recipes show no calorie or macro panel rather than an invented one. Meal planning is about what to cook, not about counting.',
  },
  {
    q: 'What happens if I miss a workout?',
    a: 'It moves to the next free day in the week if there is one, or it is simply let go. No session is made longer or harder to make up for it, and nothing in the interface treats it as a failure.',
  },
  {
    q: 'What happens to my completed workouts when the plan changes?',
    a: 'Nothing. Completed sessions and their logs are frozen. Replanning only ever touches work you have not done yet, and every adaptation is recorded as a revision you can review.',
  },
  {
    q: 'Can I pay for Pro?',
    a: 'Not in this build. Payments are not enabled, no card can be charged, and there is no fake checkout. The entitlement limits behind the plans are real and enforced on the server.',
  },
  {
    q: 'Does GymOS connect to my watch or Apple Health?',
    a: 'No. There is a consent record and a data shape for a future authorised integration, but nothing is connected. Any activity or biometric data in GymOS is data you entered yourself.',
  },
  {
    q: 'Can I take a photo of my gym to set up equipment?',
    a: 'No. GymOS ships no image-recognition model. Equipment set-up is presets, search, category browsing and custom entries.',
  },
  {
    q: 'What data does GymOS store, and can I get it out?',
    a: 'Your account, profile, consents, equipment profiles, plans, sessions, logged sets, feedback, meal plans, pantry, grocery lists, activity and anything else you enter. Settings → Privacy exports all of it as JSON and can delete your account permanently. Both are available on the free plan.',
  },
  {
    q: 'Is it different for under-18 accounts?',
    a: 'Yes, and not just cosmetically. Programming rules are more conservative, some exercises are excluded entirely, restrictive nutrition settings are refused by the server, and there is no appearance scoring anywhere in the product for anyone.',
  },
  {
    q: 'Does it work offline?',
    a: 'Partly. GymOS installs as a PWA and caches the app shell and public exercise pages you have visited. Logging a workout needs a connection. It does not claim offline sync it does not have.',
  },
  {
    q: 'Can I use it outside India?',
    a: 'Yes. The recipe library leans Indian by design, and prices are shown in rupees, but nothing about workouts, equipment or tracking is India-specific.',
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <PageHeader
        eyebrow="FAQ"
        title="Questions worth a straight answer"
        description="Including the ones where the answer is no."
      />
      <div className="space-y-3">
        {FAQS.map((item) => (
          <Card key={item.q} className="p-5">
            <h2 className="font-semibold">{item.q}</h2>
            <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">{item.a}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
