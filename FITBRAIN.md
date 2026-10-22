# FitBrain

`fitbrain-1.0.0-rules`. A **guided fitness planning assistant**, not a chatbot.

## There is no language model

No model is connected, no API key is required, and nothing FitBrain says is generated
text. Every answer is produced by deterministic code reading the user's own records and
the reviewed content libraries. Each answer carries `grounded: true` and the UI labels it
*"Computed from your records — not generated text."*

A provider interface exists for the future:

```ts
export interface LanguageModelProvider {
  readonly id: string;
  readonly configured: boolean;
  /** Rephrases an already-computed answer. It never decides what the answer is. */
  rephrase(answer: FitBrainAnswer): Promise<string>;
}
```

`activeProvider()` always returns the no-op provider. Even when one is connected it can
only rephrase — it cannot reach the planning engines, bypass a safety rule, or choose
what the answer is.

## How a question is routed

`detectIntent()` matches the query against weighted rules and returns the highest-scoring
intent, or `unknown`. Safety rules carry weight 100 so they outrank everything.

| Intent | Example | Answers from |
| --- | --- | --- |
| `explain_plan` | "Why am I doing these exercises?" | the saved plan and its explanation |
| `find_exercise` | "Exercises for my upper back" | the library, filtered by the active equipment profile |
| `explain_substitution` | "Substitute for barbell bench press" | the substitution engine |
| `exercise_instructions` | "How do I do a Romanian deadlift?" | the exercise record |
| `equipment_question` | "Can I do this at home?" | the compatibility engine |
| `shorter_session` | "I only have 20 minutes" | RealitySync's time adaptation on the real plan |
| `change_schedule` | "I missed Monday" | scheduled and missed sessions |
| `summarise_history` | "How am I doing?" | logged sets over the last 28 days |
| `find_recipe` | "Quick vegetarian dinner" | the recipe filter with allergens applied |
| `explain_meal_swap` | "Something else for Thursday dinner" | the meal plan |
| `set_preference` | "I don't like burpees" | writes to preference memory |
| `app_help` | "What is RealitySync?" | feature documentation |
| `safety_redirect` | anything medical or appearance-related | **refuses and redirects** |

An unmatched question returns `unknown` and lists the capabilities. It does not guess.

## Grounding

Every answer carries `sources` — exercises, recipes, plans, sessions, preferences or
features — each linking to the page it came from. The UI renders them as chips, so you can
check anything it says.

Exercise answers include the review-status caveat: the instructions are an internal draft
awaiting professional review.

## Memory

Stored in `preferences` and inspectable at `/fitbrain/memory`:

| Key | Effect on the generator |
| --- | --- |
| `favourite_exercises` | +8 to the candidate score |
| `disliked_exercises` | hard exclusion |
| `fitbrain_usage` | daily action count for the free-plan limit |

Every entry can be removed individually or forgotten entirely. Deleting one takes effect
on the next plan generated.

## Safety boundaries

FitBrain will not:

- diagnose an injury, symptom or condition, or say whether it is safe to train
- recommend medication, treatment or rehabilitation
- set a calorie target, weight goal or restrictive diet — for anyone, at any age
- rate appearance or compare bodies
- prescribe an exercise ruled out by equipment, age band, experience or limitations
- answer from anything other than the user's own records and the content libraries

Injury, medical, crash-diet and appearance questions route to `safety_redirect`, which
says plainly that this is outside what GymOS can help with, tells the user not to train
through pain, points them to a qualified professional, and offers the one thing GymOS
*can* do — record a limitation so plans stop including those movements.

The rules are tested: `tests/unit/safety.test.ts` asserts that a list of medical and
appearance phrasings all route to the redirect, and
`tests/integration/fitbrain.test.ts` checks the rendered answer contains the professional
referral and the "cannot diagnose" statement.

## Entitlements

Free accounts get 10 assistant actions a day, counted in `preferences.fitbrain_usage` and
enforced on the server. Pro is unlimited.
