import { describe, it, expect } from 'vitest';
import { detectIntent, FITBRAIN_CAPABILITIES, INTENT_RULES } from '@/lib/engines/fitbrain-intents';

describe('intent detection', () => {
  const cases: [string, string][] = [
    ['why am i doing these exercises this week', 'explain_plan'],
    ['substitute for barbell bench press', 'explain_substitution'],
    ['how do i do a romanian deadlift', 'exercise_instructions'],
    ['exercises for my upper back', 'find_exercise'],
    ['i only have 20 minutes today', 'shorter_session'],
    ['i missed monday', 'change_schedule'],
    ['how am i doing', 'summarise_history'],
    ['quick vegetarian dinner idea', 'find_recipe'],
    ["i don't like burpees", 'set_preference'],
    ['what is realitysync', 'app_help'],
  ];

  for (const [query, expected] of cases) {
    it(`routes "${query}" to ${expected}`, () => {
      expect(detectIntent(query).id).toBe(expected);
    });
  }

  it('returns unknown rather than guessing', () => {
    const result = detectIntent('what is the capital of France');
    expect(result.id).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('gives safety redirects the highest priority', () => {
    // A question that also looks like an exercise lookup must still be redirected.
    expect(detectIntent('how do i do a squat without knee pain').id).toBe('safety_redirect');
  });

  it('is case insensitive', () => {
    expect(detectIntent('WHY AM I DOING THESE EXERCISES').id).toBe('explain_plan');
  });

  it('has a handler for every advertised capability', () => {
    const handled = new Set(INTENT_RULES.map((r) => r.id));
    for (const capability of FITBRAIN_CAPABILITIES) {
      expect(handled.has(capability.id as never)).toBe(true);
    }
  });

  it('routes every advertised example to its own capability', () => {
    for (const capability of FITBRAIN_CAPABILITIES) {
      const detected = detectIntent(capability.example);
      expect(
        detected.id,
        `example "${capability.example}" should route to ${capability.id}`,
      ).toBe(capability.id);
    }
  });
});
