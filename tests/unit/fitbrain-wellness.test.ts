/**
 * Intent routing for the wellness modules, and — the part that matters — that the
 * questions GymOS must refuse are routed to a refusal rather than to a feature.
 */
import { describe, it, expect } from 'vitest';
import { detectIntent, FITBRAIN_CAPABILITIES } from '@/lib/engines/fitbrain-intents';

describe('appearance questions are refused, not answered', () => {
  const asked = [
    'rate my face',
    'rate my body out of 10',
    'am i attractive',
    'am i ugly',
    'how do i look in this photo',
    'score my face please',
    'help me looksmax',
    'what is my glow up score',
    'estimate my body fat from this picture',
    'can you compare me to a model',
    'do i look fat',
    'what body type am i',
  ];

  it.each(asked)('"%s" routes to the appearance refusal', (query) => {
    expect(detectIntent(query).id).toBe('appearance_redirect');
  });

  it('outranks the photo-journal and wardrobe intents', () => {
    expect(detectIntent('rate my photo in my wardrobe').id).toBe('appearance_redirect');
  });
});

describe('skin questions are refused, not diagnosed', () => {
  const asked = [
    'is this acne or something else',
    'what is this rash on my arm',
    'do i have eczema',
    'can you diagnose my skin',
    'what cream should i use for this spot',
    'is this a cyst',
    'could this be skin cancer',
  ];

  it.each(asked)('"%s" routes to the skin refusal', (query) => {
    expect(detectIntent(query).id).toBe('skin_concern_redirect');
  });
});

describe('voice questions about quality or words are refused', () => {
  const asked = [
    'is my voice good',
    'do i sound good',
    'rate my voice',
    'is my voice attractive',
    'make my voice deeper',
    'transcribe my recording',
    'what did i say in that recording',
    'can i get a transcript of my practice',
  ];

  it.each(asked)('"%s" routes to the voice refusal', (query) => {
    expect(detectIntent(query).id).toBe('voice_judgement_redirect');
  });

  it('still routes genuine practice questions to the practice intent', () => {
    expect(detectIntent('i want to practise speaking').id).toBe('voice_practice');
    expect(detectIntent('how do i work on my pace').id).toBe('voice_practice');
    expect(detectIntent('how do i stop using filler words').id).toBe('voice_practice');
  });
});

describe('wellness capabilities route correctly', () => {
  const cases: [string, string][] = [
    ['how was my week overall', 'wellness_overview'],
    ['show me my fortnightly review', 'wellness_overview'],
    ['anything due today in my routines', 'routine_due'],
    ['what is my skincare routine', 'routine_due'],
    ['do i have any expired product', 'routine_due'],
    ['what should i wear to work', 'outfit_question'],
    ['plan my clothes for the week', 'outfit_question'],
    ['who can see my photos', 'media_privacy'],
    ['delete my recordings', 'media_privacy'],
    ['is this private and encrypted', 'media_privacy'],
    ['how much storage used', 'media_privacy'],
  ];

  it.each(cases)('"%s" -> %s', (query, expected) => {
    expect(detectIntent(query).id).toBe(expected);
  });

  it('does not hijack training questions with the routine intent', () => {
    expect(detectIntent('what workout should i do today').id).not.toBe('routine_due');
    expect(detectIntent('exercise for my upper back').id).toBe('find_exercise');
  });

  it('leaves the injury redirect in charge of pain questions', () => {
    expect(detectIntent('my shoulder hurts, should i train through it').id).toBe('safety_redirect');
  });
});

describe('the capability list', () => {
  it('advertises the wellness capabilities and no refusal as a feature', () => {
    const ids = FITBRAIN_CAPABILITIES.map((c) => c.id);
    expect(ids).toContain('wellness_overview');
    expect(ids).toContain('routine_due');
    expect(ids).toContain('outfit_question');
    expect(ids).toContain('voice_practice');
    expect(ids).toContain('media_privacy');
    for (const refusal of [
      'appearance_redirect',
      'skin_concern_redirect',
      'voice_judgement_redirect',
      'safety_redirect',
    ]) {
      expect(ids).not.toContain(refusal);
    }
  });

  it('gives every capability a concrete example, so the list is usable', () => {
    for (const c of FITBRAIN_CAPABILITIES) {
      expect(c.example.length).toBeGreaterThan(8);
      expect(c.label.length).toBeGreaterThan(5);
    }
  });

  it('routes each advertised example to the capability it is advertised under', () => {
    for (const c of FITBRAIN_CAPABILITIES) {
      expect(detectIntent(c.example).id, `example for ${c.id}`).toBe(c.id);
    }
  });
});
