export type IntentId =
  | 'explain_plan'
  | 'find_exercise'
  | 'explain_substitution'
  | 'change_schedule'
  | 'exercise_instructions'
  | 'summarise_history'
  | 'find_recipe'
  | 'explain_meal_swap'
  | 'app_help'
  | 'set_preference'
  | 'shorter_session'
  | 'equipment_question'
  | 'safety_redirect'
  // Wellness modules
  | 'wellness_overview'
  | 'routine_due'
  | 'outfit_question'
  | 'voice_practice'
  | 'media_privacy'
  // Honest refusals, each with its own explanation
  | 'appearance_redirect'
  | 'skin_concern_redirect'
  | 'voice_judgement_redirect'
  | 'unknown';

export interface IntentRule {
  id: IntentId;
  /** All of these must appear for the rule to fire. */
  all?: string[];
  /** At least one of these must appear. */
  any?: string[];
  /** None of these may appear. */
  none?: string[];
  weight: number;
}

/**
 * Deterministic intent rules. FitBrain is a guided assistant, not a chatbot: it maps a
 * question onto one of a fixed set of capabilities and answers from the database.
 * If nothing matches it says so and offers the capability list.
 */
export const INTENT_RULES: IntentRule[] = [
  // Safety redirects are checked first and outrank everything else.
  {
    id: 'safety_redirect',
    any: [
      'injur', 'pain', 'hurts', 'hurting', 'hurt my', 'sprain', 'strained', 'torn', 'tear',
      'tore', 'pulled a muscle', 'snapped', 'popped', 'diagnos', 'doctor', 'physio',
      'medicine', 'medication', 'tablet', 'painkiller', 'symptom', 'swollen', 'swelling',
      'inflamed', 'sharp pain', 'numb', 'tingling', 'dizzy', 'faint', 'chest pain',
      'disease', 'diabet', 'thyroid', 'asthma', 'blood pressure', 'pregnan', 'postpartum',
      'surgery', 'operation', 'treatment', 'cure', 'heal my', 'rehab', 'is it safe to train',
      'should i train through',
    ],
    weight: 100,
  },
  {
    id: 'safety_redirect',
    // Appearance wording moved to `appearance_redirect`, which gives the same refusal
    // with an explanation specific to body and face questions.
    any: ['lose weight fast', 'how many calories should i', 'crash diet', 'skip meals', 'fat burn'],
    weight: 100,
  },
  // Appearance questions get their own refusal rather than the injury one, because
  // the honest answer is different: GymOS *could* not answer this, and *would* not.
  {
    id: 'appearance_redirect',
    any: [
      'rate my face', 'rate my looks', 'rate my body', 'how attractive', 'am i attractive',
      'am i ugly', 'how do i look', 'how good do i look', 'score my face', 'rate my photo',
      'rate my picture', 'looksmax', 'looks max', 'glow up score', 'facial harmony',
      'am i good looking', 'out of 10', 'out of ten', 'my jawline', 'my face shape',
      'body fat from', 'estimate my body fat', 'what body type am i', 'am i fat',
      'do i look fat', 'compare me to', 'better looking', 'body fat percentage',
    ],
    // Above the general safety redirect, so an appearance question gets the answer
    // written for it rather than the injury one.
    weight: 110,
  },
  {
    id: 'skin_concern_redirect',
    any: [
      'is this acne', 'do i have acne', 'what is this rash', 'this rash', 'this spot',
      'this mole', 'my skin condition', 'diagnose my skin', 'is my skin healthy',
      'eczema', 'psoriasis', 'rosacea', 'fungal', 'infection on my', 'melasma',
      'what cream should i use for', 'prescribe', 'retinoid dose', 'is this a cyst',
      'skin cancer',
    ],
    weight: 110,
  },
  {
    id: 'voice_judgement_redirect',
    any: [
      'is my voice good', 'do i sound good', 'rate my voice', 'does my voice sound',
      'is my voice attractive', 'my voice too high', 'my voice too deep', 'sound more masculine',
      'sound more feminine', 'make my voice deeper', 'transcribe my recording',
      'what did i say', 'transcript of my',
    ],
    weight: 110,
  },
  { id: 'explain_plan', any: ['why this plan', 'explain my plan', 'why these exercises', 'why am i doing', 'what is my plan', 'my plan', 'this week'], weight: 20 },
  { id: 'explain_substitution', any: ['substitute', 'swap', 'replace', 'instead of', 'alternative to', 'different exercise'], weight: 22 },
  { id: 'exercise_instructions', any: ['how do i do', 'how to do', 'technique for', 'form for', 'instructions for', 'teach me'], weight: 24 },
  { id: 'find_exercise', any: ['exercise for', 'exercises for', 'what can i do for', 'work my', 'train my', 'hit my', 'show me exercises'], weight: 18 },
  { id: 'equipment_question', any: ['equipment', 'do i need', 'without a', 'no gym', 'at home', 'what can i do with'], weight: 16 },
  { id: 'shorter_session', any: ['shorter', 'less time', 'only have', 'quick workout', '20 minutes', '15 minutes', '30 minutes', 'short on time'], weight: 22 },
  { id: 'change_schedule', any: ['reschedule', 'move my workout', 'change my days', 'train on', 'skip today', 'missed'], weight: 20 },
  { id: 'summarise_history', any: ['how am i doing', 'my progress', 'summary', 'last week', 'how many workouts', 'history', 'what did i do'], weight: 18 },
  { id: 'find_recipe', any: ['recipe', 'what should i eat', 'meal idea', 'cook', 'dinner idea', 'lunch idea', 'breakfast idea'], weight: 18 },
  {
    id: 'explain_meal_swap',
    any: [
      'swap my meal', 'swap this meal', 'change my meal', 'different meal', 'another recipe',
      'replace dinner', 'replace lunch', 'replace breakfast', 'something else for',
      'anything else for', 'swap dinner', 'swap lunch', 'swap breakfast', 'change dinner',
      'change lunch', 'change breakfast', 'dont want to cook', "don't want to cook",
    ],
    weight: 26,
  },
  { id: 'set_preference', any: ["i don't like", 'i dont like', 'i hate', 'never show', 'favourite', 'favorite', 'i prefer', 'remember that'], weight: 24 },
  {
    id: 'wellness_overview',
    any: [
      'my review', 'weekly review', 'fortnightly review', 'how is everything going',
      'overview of everything', 'across everything', 'personal review', 'how was my week',
    ],
    weight: 22,
  },
  {
    id: 'routine_due',
    any: [
      'due today', 'what should i do today', 'my routine', 'my routines', 'skincare routine',
      'grooming routine', 'hygiene', 'brush', 'moisturis', 'moisturiz', 'shave', 'wash my',
      'what is due', 'anything due', 'expired product', 'running low',
    ],
    none: ['workout', 'exercise'],
    weight: 20,
  },
  {
    id: 'outfit_question',
    any: [
      'what should i wear', 'what do i wear', 'outfit', 'wardrobe', 'clothes', 'shirt',
      'trousers', 'what to wear', 'dress for', 'plan my clothes',
    ],
    weight: 20,
  },
  {
    id: 'voice_practice',
    any: [
      'practise speaking', 'practice speaking', 'speaking practice', 'my pace', 'speak slower',
      'speak faster', 'words per minute', 'interview practice', 'pitch practice',
      'filler words', 'um and uh', 'public speaking',
    ],
    weight: 20,
  },
  {
    id: 'media_privacy',
    any: [
      'my photos', 'my pictures', 'my recordings', 'delete my photos', 'delete my recordings',
      'who can see', 'is this private', 'encrypted', 'storage used', 'stop storing',
      'turn off photos', 'revoke', 'share my photo',
    ],
    weight: 24,
  },
  { id: 'app_help', any: ['how do i use', 'where is', 'how does gymos', 'what is realitysync', 'what is equipment dna', 'pro plan', 'subscription', 'export my data', 'delete my account'], weight: 16 },
];

export interface IntentMatch {
  id: IntentId;
  confidence: number;
  matchedTerms: string[];
}

export function detectIntent(query: string): IntentMatch {
  const q = query.toLowerCase();
  let best: IntentMatch = { id: 'unknown', confidence: 0, matchedTerms: [] };
  for (const rule of INTENT_RULES) {
    if (rule.none?.some((t) => q.includes(t))) continue;
    if (rule.all && !rule.all.every((t) => q.includes(t))) continue;
    const matched = (rule.any ?? []).filter((t) => q.includes(t));
    if (rule.any && matched.length === 0) continue;
    const score = rule.weight + matched.length * 2;
    if (score > best.confidence) {
      best = { id: rule.id, confidence: score, matchedTerms: matched };
    }
  }
  return best;
}

export const FITBRAIN_CAPABILITIES = [
  { id: 'explain_plan', label: 'Explain my current plan', example: 'Why am I doing these exercises this week?' },
  { id: 'find_exercise', label: 'Find exercises I can actually do', example: 'Exercises for my upper back' },
  { id: 'explain_substitution', label: 'Suggest a substitute', example: 'Substitute for barbell bench press' },
  { id: 'exercise_instructions', label: 'Look up instructions', example: 'How do I do a Romanian deadlift?' },
  { id: 'shorter_session', label: 'Build a shorter session', example: 'I only have 20 minutes today' },
  { id: 'change_schedule', label: 'Move a workout', example: 'I missed Monday, what now?' },
  { id: 'summarise_history', label: 'Summarise what I have logged', example: 'How many workouts last week?' },
  { id: 'find_recipe', label: 'Find a recipe that fits', example: 'Quick vegetarian dinner idea' },
  { id: 'explain_meal_swap', label: 'Swap a planned meal', example: 'Something else for Thursday dinner' },
  { id: 'set_preference', label: 'Remember a preference', example: "I don't like burpees" },
  { id: 'wellness_overview', label: 'Review everything at once', example: 'How was my week overall?' },
  { id: 'routine_due', label: 'Say what is due today', example: 'Anything due in my routines today?' },
  { id: 'outfit_question', label: 'Help with an outfit', example: 'What should I wear to work?' },
  { id: 'voice_practice', label: 'Set up speaking practice', example: 'I want to practise my pace' },
  { id: 'media_privacy', label: 'Explain or change media privacy', example: 'Who can see my photos?' },
  { id: 'app_help', label: 'Explain a GymOS feature', example: 'What is RealitySync?' },
] as const;
