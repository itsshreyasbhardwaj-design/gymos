import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getProfile } from '@/lib/services/account';
import { getNutritionPrefs } from '@/lib/services/nutrition';
import { listGymProfiles, getGymProfile } from '@/lib/services/equipment';
import { EQUIPMENT_CATALOG, EQUIPMENT_CATEGORY_LABELS, EQUIPMENT_PRESETS } from '@/lib/content/equipment';
import { ALLERGEN_CATALOG, INGREDIENT_CATALOG } from '@/lib/content/nutrition-base';
import { CUISINE_LABELS } from '@/lib/content/recipes';
import { TRAINING_INTERESTS, DAY_NAMES } from '@/lib/engines/workout-templates';
import { LIMITATION_OPTIONS, MEDICAL_DISCLAIMER } from '@/lib/engines/programming';
import { Badge, Card, Field, Input, KeyValue, Notice, Select, Textarea, Button } from '@/components/ui';
import { StepForm, OptionCard, EquipmentStep } from '@/components/onboarding-steps';
import { saveStep, finishOnboarding } from './actions';
import { cn } from '@/lib/ui/cn';

export const metadata: Metadata = { title: 'Set up GymOS' };

const STEP_TITLES = [
  'Basic profile',
  'Fitness experience',
  'Training interests',
  'Availability',
  'Training environment',
  'Equipment',
  'Nutrition preferences',
  'Review',
  'Your first plan',
];

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const profile = getProfile(user.id);
  if (profile?.onboardingCompletedAt) redirect('/dashboard');

  const requested = Number(params.step ?? profile?.onboardingStep ?? 1);
  const furthest = Math.max(1, profile?.onboardingStep ?? 1);
  const step = Math.min(Math.max(1, requested), Math.min(9, furthest));

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between mb-6">
          <Link href="/" className="font-semibold tracking-tight">
            GymOS
          </Link>
          <Badge tone="neutral">
            Step {step} of 9
          </Badge>
        </div>

        <nav aria-label="Onboarding progress" className="mb-8">
          <ol className="flex flex-wrap gap-1.5">
            {STEP_TITLES.map((title, i) => {
              const n = i + 1;
              const done = n < furthest;
              const current = n === step;
              const reachable = n <= furthest;
              const content = (
                <span
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                    current
                      ? 'bg-[var(--accent)] text-white'
                      : done
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'bg-[var(--surface-sunken)] text-[var(--text-muted)]',
                  )}
                >
                  {done ? <Check className="h-3 w-3" aria-hidden="true" /> : <span>{n}</span>}
                  <span className="hidden sm:inline">{title}</span>
                </span>
              );
              return (
                <li key={title}>
                  {reachable && !current ? (
                    <Link href={`/onboarding?step=${n}`} aria-current={undefined}>
                      {content}
                    </Link>
                  ) : (
                    <span aria-current={current ? 'step' : undefined}>{content}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <h1 className="text-2xl font-semibold tracking-tight mb-1">{STEP_TITLES[step - 1]}</h1>
        <p className="text-[var(--text-muted)] mb-6">{DESCRIPTIONS[step - 1]}</p>

        {step === 1 ? <Step1 profile={profile} /> : null}
        {step === 2 ? <Step2 profile={profile} /> : null}
        {step === 3 ? <Step3 profile={profile} /> : null}
        {step === 4 ? <Step4 profile={profile} /> : null}
        {step === 5 ? <Step5 profile={profile} /> : null}
        {step === 6 ? <Step6 userId={user.id} /> : null}
        {step === 7 ? <Step7 userId={user.id} ageBand={profile?.ageBand ?? 'adult_18_plus'} /> : null}
        {step === 8 ? <Step8 userId={user.id} /> : null}
        {step === 9 ? <Step9 /> : null}
      </div>
    </div>
  );
}

const DESCRIPTIONS = [
  'Just enough to greet you properly and set the right experience for your age group.',
  'There is no wrong answer here. It changes how conservative your first plan is.',
  'What do you want out of training? Pick as many as apply.',
  'When can you realistically train, and for how long?',
  'Where will most of your training happen?',
  'This is the important one. GymOS will only prescribe exercises you can actually do.',
  'Optional, and you can skip anything. Allergies are treated as a hard rule.',
  'Check everything over before GymOS builds your plan.',
  'Ready when you are.',
];

type Profile = NonNullable<ReturnType<typeof getProfile>>;

function Step1({ profile }: { profile: Profile | null }) {
  return (
    <StepForm step={1} action={saveStep}>
      <Card className="p-5 space-y-5">
        <Field label="What should we call you?" htmlFor="displayName" required>
          <Input
            id="displayName"
            name="displayName"
            defaultValue={profile?.displayName ?? ''}
            maxLength={60}
            required
            autoComplete="nickname"
          />
        </Field>

        <fieldset>
          <legend className="text-sm font-medium mb-2">Age group</legend>
          <p className="text-sm text-[var(--text-muted)] mb-3">
            This genuinely changes the product: under-18 accounts get more conservative programming
            and no restrictive nutrition tools at all.
          </p>
          <div className="grid gap-2">
            <OptionCard
              type="radio"
              name="ageBand"
              value="under_13"
              title="Under 13"
              description="Activity sessions focused on movement skills, balance and enjoyment."
              defaultChecked={profile?.ageBand === 'under_13'}
            />
            <OptionCard
              type="radio"
              name="ageBand"
              value="teen_13_17"
              title="13 to 17"
              description="Technique-first strength work with conservative volume."
              defaultChecked={profile?.ageBand === 'teen_13_17'}
            />
            <OptionCard
              type="radio"
              name="ageBand"
              value="adult_18_plus"
              title="18 or over"
              description="Full programming options."
              defaultChecked={!profile || profile.ageBand === 'adult_18_plus'}
            />
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Language" htmlFor="language">
            <Select id="language" name="language" defaultValue={profile?.language ?? 'en-IN'}>
              <option value="en-IN">English (India)</option>
              <option value="en-GB">English (UK)</option>
              <option value="en-US">English (US)</option>
            </Select>
          </Field>
          <Field label="Time zone" htmlFor="timezone">
            <Select id="timezone" name="timezone" defaultValue={profile?.timezone ?? 'Asia/Kolkata'}>
              <option value="Asia/Kolkata">India (IST)</option>
              <option value="Asia/Dubai">Gulf (GST)</option>
              <option value="Europe/London">UK</option>
              <option value="America/New_York">US Eastern</option>
              <option value="UTC">UTC</option>
            </Select>
          </Field>
        </div>

        <Field label="Units" htmlFor="units">
          <Select id="units" name="units" defaultValue={profile?.units ?? 'metric'}>
            <option value="metric">Metric (kg)</option>
            <option value="imperial">Imperial (lb)</option>
          </Select>
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Accessibility preferences</legend>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="reduceMotion"
              defaultChecked={profile?.accessibility?.reduceMotion}
              className="h-5 w-5 accent-[var(--accent)]"
            />
            Reduce motion and animation
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="largeText"
              defaultChecked={profile?.accessibility?.largeText}
              className="h-5 w-5 accent-[var(--accent)]"
            />
            Slightly larger text
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="highContrast"
              defaultChecked={profile?.accessibility?.highContrast}
              className="h-5 w-5 accent-[var(--accent)]"
            />
            Higher contrast borders and labels
          </label>
        </fieldset>

        <Notice tone="neutral">
          GymOS does not ask for your height, weight or body measurements. None of them are needed
          to plan training, so none of them are collected here.
        </Notice>
      </Card>
    </StepForm>
  );
}

function Step2({ profile }: { profile: Profile | null }) {
  return (
    <StepForm step={2} action={saveStep}>
      <Card className="p-5 space-y-5">
        <fieldset>
          <legend className="text-sm font-medium mb-3">How much training have you done?</legend>
          <div className="grid gap-2">
            <OptionCard type="radio" name="experience" value="new" title="New to exercise" description="Starting out, or starting again after a long break." defaultChecked={!profile || profile.experience === 'new'} />
            <OptionCard type="radio" name="experience" value="some" title="Some experience" description="You have trained before and know the basics." defaultChecked={profile?.experience === 'some'} />
            <OptionCard type="radio" name="experience" value="regular" title="Regularly active" description="You train consistently and are comfortable with most lifts." defaultChecked={profile?.experience === 'regular'} />
            <OptionCard type="radio" name="experience" value="experienced" title="Experienced" description="Years of structured training behind you." defaultChecked={profile?.experience === 'experienced'} />
          </div>
        </fieldset>
        <Field
          label="Activities you enjoy"
          htmlFor="activities"
          hint="Comma separated — badminton, swimming, cycling. Used to shape the supporting work, not to replace it."
        >
          <Input id="activities" name="activities" defaultValue={(profile?.activities ?? []).join(', ')} />
        </Field>
      </Card>
    </StepForm>
  );
}

function Step3({ profile }: { profile: Profile | null }) {
  return (
    <StepForm step={3} action={saveStep}>
      <Card className="p-5">
        <fieldset>
          <legend className="sr-only">Training interests</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {TRAINING_INTERESTS.map((interest) => (
              <OptionCard
                key={interest.id}
                type="checkbox"
                name="interests"
                value={interest.id}
                title={interest.label}
                defaultChecked={(profile?.interests ?? []).includes(interest.id)}
              />
            ))}
          </div>
        </fieldset>
        <Notice tone="neutral" className="mt-4">
          GymOS does not tie training to appearance goals. There are no &ldquo;get lean&rdquo; or
          &ldquo;tone up&rdquo; options, and nothing here sets a weight target.
        </Notice>
      </Card>
    </StepForm>
  );
}

function Step4({ profile }: { profile: Profile | null }) {
  const days = profile?.trainingDays ?? [1, 3, 5];
  return (
    <StepForm step={4} action={saveStep}>
      <Card className="p-5 space-y-5">
        <fieldset>
          <legend className="text-sm font-medium mb-3">Which days can you train?</legend>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DAY_NAMES.map((name, i) => (
              <OptionCard
                key={name}
                type="checkbox"
                name="trainingDays"
                value={String(i)}
                title={name}
                defaultChecked={days.includes(i)}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="How long per session?" htmlFor="sessionMinutes">
            <Select id="sessionMinutes" name="sessionMinutes" defaultValue={String(profile?.sessionMinutes ?? 45)}>
              {[20, 30, 40, 45, 60, 75, 90].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Usual time of day" htmlFor="preferredTime" hint="Optional.">
            <Select id="preferredTime" name="preferredTime" defaultValue={profile?.preferredTime ?? ''}>
              <option value="">No preference</option>
              <option value="early_morning">Early morning</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
              <option value="night">Night</option>
            </Select>
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium mb-3">How flexible is your schedule?</legend>
          <div className="grid gap-2">
            <OptionCard type="radio" name="scheduleFlexibility" value="rigid" title="Fixed" description="If I miss a day, it is gone — do not move things around." defaultChecked={profile?.scheduleFlexibility === 'rigid'} />
            <OptionCard type="radio" name="scheduleFlexibility" value="some" title="Somewhat flexible" description="Move a missed session if there is a free day." defaultChecked={!profile || profile.scheduleFlexibility === 'some'} />
            <OptionCard type="radio" name="scheduleFlexibility" value="flexible" title="Very flexible" description="Rearrange freely within the week." defaultChecked={profile?.scheduleFlexibility === 'flexible'} />
          </div>
        </fieldset>
      </Card>
    </StepForm>
  );
}

function Step5({ profile }: { profile: Profile | null }) {
  return (
    <StepForm step={5} action={saveStep}>
      <Card className="p-5 space-y-5">
        <fieldset>
          <legend className="text-sm font-medium mb-3">Where do you usually train?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { id: 'home', label: 'Home' },
              { id: 'commercial_gym', label: 'Commercial gym' },
              { id: 'apartment_gym', label: 'Apartment or society gym' },
              { id: 'outdoor', label: 'Outdoors' },
              { id: 'travel', label: 'Travelling' },
              { id: 'custom', label: 'Somewhere else' },
            ].map((env) => (
              <OptionCard
                key={env.id}
                type="radio"
                name="environment"
                value={env.id}
                title={env.label}
                defaultChecked={(profile?.environment ?? 'home') === env.id}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium mb-2">Anything feeling sensitive right now?</legend>
          <p className="text-sm text-[var(--text-muted)] mb-3">
            Optional. GymOS will stop suggesting movements that commonly load that area. It is not
            a diagnosis and not a treatment plan.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {LIMITATION_OPTIONS.map((lim) => (
              <OptionCard
                key={lim.id}
                type="checkbox"
                name="limitations"
                value={lim.id}
                title={lim.label}
                defaultChecked={(profile?.limitations ?? []).includes(lim.id)}
              />
            ))}
          </div>
        </fieldset>

        <Notice tone="warn">{MEDICAL_DISCLAIMER}</Notice>
      </Card>
    </StepForm>
  );
}

function Step6({ userId }: { userId: string }) {
  const options = EQUIPMENT_CATALOG.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    categoryLabel: EQUIPMENT_CATEGORY_LABELS[e.category],
    aliases: e.aliases ?? [],
    description: e.description ?? '',
  }));
  const presets = Object.entries(EQUIPMENT_PRESETS).map(([key, p]) => ({
    key,
    label: p.label,
    description: p.description,
    ids: p.ids,
  }));
  const existing = listGymProfiles(userId);
  const first = existing[0];
  const initial = first ? getGymProfile(userId, first.id).items.map((i) => i.equipmentTypeId) : [];

  return (
    <StepForm step={6} action={saveStep}>
      <EquipmentStep options={options} presets={presets} initialSelected={initial} />
    </StepForm>
  );
}

function Step7({ userId, ageBand }: { userId: string; ageBand: string }) {
  const prefs = getNutritionPrefs(userId);
  const commonDislikes = [
    'brinjal',
    'okra',
    'bottle-gourd',
    'mushroom',
    'capsicum',
    'coconut-fresh',
    'paneer',
    'beetroot',
    'radish',
    'pumpkin',
  ]
    .map((id) => INGREDIENT_CATALOG.find((i) => i.id === id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return (
    <StepForm step={7} action={saveStep}>
      <Card className="p-5 space-y-5">
        <fieldset>
          <legend className="text-sm font-medium mb-3">Dietary preference</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { id: 'no_preference', label: 'No preference' },
              { id: 'vegetarian', label: 'Vegetarian' },
              { id: 'vegan', label: 'Vegan' },
              { id: 'eggetarian', label: 'Vegetarian plus egg' },
              { id: 'non_vegetarian', label: 'Non-vegetarian' },
            ].map((d) => (
              <OptionCard
                key={d.id}
                type="radio"
                name="diet"
                value={d.id}
                title={d.label}
                defaultChecked={prefs.diet === d.id}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium mb-2">Allergies</legend>
          <p className="text-sm text-[var(--text-muted)] mb-3">
            Anything selected here is excluded completely — including recipes where it is only an
            optional ingredient.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ALLERGEN_CATALOG.map((a) => (
              <OptionCard
                key={a.id}
                type="checkbox"
                name="allergens"
                value={a.id}
                title={a.name}
                defaultChecked={prefs.allergenIds.includes(a.id)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium mb-2">Cuisines you enjoy</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(CUISINE_LABELS).map(([id, label]) => (
              <OptionCard
                key={id}
                type="checkbox"
                name="cuisines"
                value={id}
                title={label}
                defaultChecked={prefs.cuisines.includes(id)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium mb-2">Ingredients you would rather avoid</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {commonDislikes.map((ing) => (
              <OptionCard
                key={ing.id}
                type="checkbox"
                name="dislikes"
                value={ing.id}
                title={ing.name}
                defaultChecked={prefs.dislikedIngredientIds.includes(ing.id)}
              />
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Cooking confidence" htmlFor="cookingSkill">
            <Select id="cookingSkill" name="cookingSkill" defaultValue={prefs.cookingSkill}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Comfortable</option>
              <option value="confident">Confident</option>
            </Select>
          </Field>
          <Field label="Max time per meal" htmlFor="maxPrepMinutes">
            <Select id="maxPrepMinutes" name="maxPrepMinutes" defaultValue={String(prefs.maxPrepMinutes)}>
              {[15, 20, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cooking for" htmlFor="householdSize">
            <Select id="householdSize" name="householdSize" defaultValue={String(prefs.householdSize)}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'person' : 'people'}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="includeSnacks"
            defaultChecked={prefs.includeSnacks}
            className="h-5 w-5 accent-[var(--accent)]"
          />
          Include snack suggestions
        </label>

        <Field
          label="Medical dietary requirements"
          htmlFor="medicalDietaryNote"
          hint="Optional. GymOS does not build therapeutic diets — this is only recorded so it can warn you to involve a qualified dietitian."
        >
          <Textarea
            id="medicalDietaryNote"
            name="medicalDietaryNote"
            maxLength={500}
            defaultValue={prefs.medicalDietaryNote}
            rows={3}
          />
        </Field>

        {ageBand !== 'adult_18_plus' ? (
          <Notice tone="teal">
            Because this is an under-18 account, GymOS will not offer calorie targets, weight goals
            or restrictive plans. That is enforced on the server, not just hidden here.
          </Notice>
        ) : null}
      </Card>
    </StepForm>
  );
}

function Step8({ userId }: { userId: string }) {
  const profile = getProfile(userId);
  const prefs = getNutritionPrefs(userId);
  const gyms = listGymProfiles(userId);
  const equipmentCount = gyms[0]?.equipmentCount ?? 0;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h2 className="font-semibold mb-3">Your profile</h2>
        <KeyValue
          items={[
            { label: 'Name', value: profile?.displayName ?? '—' },
            {
              label: 'Age group',
              value:
                profile?.ageBand === 'under_13'
                  ? 'Under 13'
                  : profile?.ageBand === 'teen_13_17'
                    ? '13 to 17'
                    : '18 or over',
            },
            { label: 'Experience', value: profile?.experience ?? '—' },
            {
              label: 'Interests',
              value:
                (profile?.interests ?? [])
                  .map((i) => TRAINING_INTERESTS.find((t) => t.id === i)?.label ?? i)
                  .join(', ') || 'None selected',
            },
            {
              label: 'Training days',
              value: (profile?.trainingDays ?? []).map((d) => DAY_NAMES[d]).join(', ') || '—',
            },
            { label: 'Session length', value: `${profile?.sessionMinutes ?? 45} minutes` },
            { label: 'Environment', value: profile?.environment ?? '—' },
            {
              label: 'Sensitivities noted',
              value:
                (profile?.limitations ?? [])
                  .map((l) => LIMITATION_OPTIONS.find((o) => o.id === l)?.label ?? l)
                  .join(', ') || 'None',
            },
          ]}
        />
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Equipment</h2>
        <p className="text-sm text-[var(--text-muted)]">
          {gyms[0] ? `${gyms[0].name}: ${equipmentCount} item(s) available.` : 'No profile created yet.'}
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Food preferences</h2>
        <KeyValue
          items={[
            { label: 'Diet', value: prefs.diet.replace(/_/g, ' ') },
            { label: 'Allergies', value: prefs.allergenIds.join(', ') || 'None declared' },
            { label: 'Cuisines', value: prefs.cuisines.join(', ') || 'No preference' },
            { label: 'Max time per meal', value: `${prefs.maxPrepMinutes} minutes` },
            { label: 'Cooking for', value: `${prefs.householdSize}` },
          ]}
        />
      </Card>

      <Notice tone="neutral">
        Anything wrong? Use the step links above to go back and change it. Everything here can also
        be edited later from Settings.
      </Notice>

      <StepForm step={8} action={saveStep} submitLabel="Looks right — continue">
        <span className="sr-only">Confirm review</span>
      </StepForm>
    </div>
  );
}

function Step9() {
  return (
    <Card className="p-6 text-center">
      <h2 className="text-xl font-semibold">Build your first plan</h2>
      <p className="text-[var(--text-muted)] mt-2 max-w-lg mx-auto leading-relaxed">
        GymOS will generate an editable weekly plan from your equipment, your days and your
        experience — and tell you honestly if a movement pattern cannot be covered with what you
        have. Nothing is locked in: you can swap, remove or regenerate anything.
      </p>
      <form action={finishOnboarding} className="mt-6">
        <Button type="submit" size="lg">
          Generate my plan
        </Button>
      </form>
    </Card>
  );
}
