/**
 * The practice-script library.
 *
 * Provenance: every passage below was written for GymOS — all of them carry
 * `provenance: 'original'`. None of it is quoted, adapted or paraphrased from a
 * published work, so there is nothing here that needs a licence or an attribution.
 * If you add a script, write it yourself (`'original'`) or take something
 * unambiguously in the public domain and label it `'public_domain'`, or
 * `'adapted_public_domain'` if you reworded it. Those are the three values
 * `VoiceScriptProvenance` admits, and a non-original passage must also carry a
 * `provenanceSource` naming the work it came from; a test enforces that pairing.
 * Nothing here may be stamped `'original'` unless it genuinely is.
 *
 * Two modes, and the distinction is load-bearing rather than cosmetic:
 *
 *  - `read_aloud` — the text IS the words you say. The word count is therefore the
 *    number of words you spoke, so words-per-minute can be worked out from a
 *    measured duration.
 *  - `prompt` — the text is a brief; the words you say are your own. GymOS has no
 *    speech recognition, so it has no idea how many words you said. Scripts in this
 *    mode carry `spokenWordCount: null`, and words-per-minute stays unmeasured.
 *
 * This file imports nothing. It is data and two pure helpers.
 */

/** Must stay a subset of VOICE_PRACTICE_KINDS in lib/db/schema.ts. A test enforces it. */
export const VOICE_SCRIPT_KINDS = [
  'script_reading',
  'pronunciation',
  'presentation',
  'interview',
  'conversation',
  'free_speaking',
] as const;

export type VoiceScriptKind = (typeof VOICE_SCRIPT_KINDS)[number];

export type VoiceScriptMode = 'read_aloud' | 'prompt';

/**
 * Where a passage came from.
 *
 *  - `original` — written for GymOS. Nothing quoted, adapted or paraphrased.
 *  - `public_domain` — reproduced verbatim from a work in the public domain.
 *  - `adapted_public_domain` — reworded or abridged from such a work.
 *
 * The last two exist so the instruction at the top of this file can actually be
 * followed: without them a public-domain passage would have to be stamped
 * `original`, which would be a false claim about who wrote it.
 */
export const VOICE_SCRIPT_PROVENANCES = [
  'original',
  'public_domain',
  'adapted_public_domain',
] as const;

export type VoiceScriptProvenance = (typeof VOICE_SCRIPT_PROVENANCES)[number];

export const VOICE_SCRIPT_KIND_LABELS: Record<VoiceScriptKind, string> = {
  script_reading: 'Reading for pace',
  pronunciation: 'Articulation drill',
  presentation: 'Presenting',
  interview: 'Interview answer',
  conversation: 'Conversation',
  free_speaking: 'Free speaking',
};

/**
 * The rate used to turn a word count into a rough reading time.
 *
 * 140 words a minute sits in the middle of the range commonly cited for unhurried
 * read-aloud English. It produces an estimate only: your own take will be longer or
 * shorter, and neither is a problem.
 */
export const REFERENCE_READING_WPM = 140;

/**
 * Counts words in a script.
 *
 * The rule, stated exactly so it can be checked independently: split on any run of
 * whitespace, then keep only the tokens that contain at least one letter or digit.
 * A standalone dash or ellipsis is punctuation, not a word. Hyphenated and
 * apostrophised forms count once, as a speaker says them once.
 */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

interface VoiceScriptSeed {
  id: string;
  title: string;
  kind: VoiceScriptKind;
  mode: VoiceScriptMode;
  text: string;
  /** Plain, specific, non-judgemental: what to pay attention to in this take. */
  focus: string;
  /** Only for prompt-mode scripts: how long an answer to aim for. */
  targetSeconds?: number;
  /** Defaults to 'original'. Set it when the passage is not GymOS's own writing. */
  provenance?: VoiceScriptProvenance;
  /** Required for anything that is not 'original': the work it came from. */
  provenanceSource?: string;
}

export interface VoiceScript {
  id: string;
  title: string;
  kind: VoiceScriptKind;
  mode: VoiceScriptMode;
  text: string;
  focus: string;
  /** Words in `text`, by `countWords`. */
  wordCount: number;
  /** Words you will actually speak, when that is knowable. Null for prompts. */
  spokenWordCount: number | null;
  /** A rough length. For prompts it is the suggested target, not a measurement. */
  estimatedSeconds: number;
  provenance: VoiceScriptProvenance;
  /** Null for original writing; the named source for anything else. */
  provenanceSource: string | null;
}

const SEEDS: VoiceScriptSeed[] = [
  /* ------------------------------------------------------- reading for pace */
  {
    id: 'pace-morning-platform',
    title: 'The morning platform',
    kind: 'script_reading',
    mode: 'read_aloud',
    focus:
      'Read it the way you would read it to one person sitting opposite you. Let the full stops be full stops.',
    text: `The six-forty train is never quite on time, and the people who take it have stopped expecting it to be. They stand in the same places along the platform, a little apart from one another, each of them watching the same bend in the track. When the train finally arrives it is already full, so everyone boards in a single patient shuffle and nobody complains out loud. There is a particular quiet to a carriage at that hour. It is not the quiet of a library, where silence is a rule, but the quiet of people who have agreed, without discussing it, that the day has not started yet.`,
  },
  {
    id: 'pace-river-crossing',
    title: 'Crossing the river twice',
    kind: 'script_reading',
    mode: 'read_aloud',
    focus:
      'A longer passage. Notice where you take breath, and whether you are still taking breath in the same places by the end.',
    text: `There were two bridges across the river and the town could never agree on which one was the real one. The old bridge was narrow, built from stone the colour of wet rope, and it had carried carts and then cars and then, for the last twenty years, nothing heavier than a bicycle. The new bridge was wide and grey and entirely sensible. It had been designed by somebody who had never lived in the town, and it did its job without asking for anything in return. People drove over the new bridge every day without looking at it. They walked over the old one on Sundays and stopped halfway to look down at the water, which is a thing you cannot do on a road. Somebody once suggested that the old bridge be demolished, since it no longer carried anything. The proposal was discussed for a single evening and then quietly withdrawn, because it turned out that almost everyone in the room had something they wanted to say about standing in the middle of that bridge, and none of it had anything to do with crossing the river.`,
  },
  {
    id: 'pace-figures-aloud',
    title: 'Figures read aloud',
    kind: 'script_reading',
    mode: 'read_aloud',
    focus:
      'Numbers are where clear speech is hardest to fake. Say each figure at the same pace as the words around it.',
    text: `The report covers the period from the first of April to the thirty-first of March. Revenue was four hundred and twelve thousand rupees, against a forecast of three hundred and ninety thousand. Of that, sixty-two per cent came from repeat customers, up from fifty-four per cent the year before. We opened nine new accounts in the third quarter and lost two. The average order value was one thousand, one hundred and forty rupees. Costs rose by eleven per cent, almost all of it in logistics. I will take questions on any of those figures at the end.`,
  },

  /* ------------------------------------------------------ articulation drills */
  {
    id: 'artic-kettle-ladder',
    title: 'The copper kettle ladder',
    kind: 'pronunciation',
    mode: 'read_aloud',
    focus:
      'Slowly first, then once more at a normal pace. Accuracy before speed; tripping over it is the point of the drill.',
    text: `A copper kettle clatters on a crooked kitchen counter. The crooked counter cracks, the copper kettle topples, and the clattering carries clean across the courtyard. Carry the kettle carefully, keep the counter clear, and the clattering kettle keeps its copper lid.`,
  },
  {
    id: 'artic-plosive-ladder',
    title: 'Plosive ladder',
    kind: 'pronunciation',
    mode: 'read_aloud',
    focus:
      'Consonant clusters at the ends of words. Finish each word before starting the next one.',
    text: `Strict scripts shift swiftly. Twelfth texts test tense tongues. The sixth stitched strap slipped past the clasped glass. Grasped facts, crisp drafts, blunt prompts, and strict stripped scripts shift swiftly still.`,
  },
  {
    id: 'artic-sibilant-street',
    title: 'Sibilant street',
    kind: 'pronunciation',
    mode: 'read_aloud',
    focus:
      'The contrast between an s and a sh. If they start to blur, slow down rather than pushing harder.',
    text: `She sells sheet steel on a short shady street, and the sharp steel sheets she stacks are shipped by ship. Sixty shining sheets sit stacked beside the shutter. Should she ship the shining sheets, or should the shining sheets stay stacked?`,
  },

  /* ------------------------------------------------------------- presenting */
  {
    id: 'present-project-update',
    title: 'Sixty-second project update',
    kind: 'presentation',
    mode: 'read_aloud',
    focus:
      'A written update read as written. Keep the pace even from the first line to the last; updates tend to speed up at the end.',
    text: `Here is where the migration stands. We moved the first three services over last week and all three are running on the new cluster without changes. Response times are unchanged, which is what we wanted; this was never meant to make anything faster. Two services are left. The billing service is the harder one, because it writes to a database we do not own, and we need a window from the finance team before we touch it. I have asked for a window in the second week of next month. The reporting service can move any time and I would like to do it on Thursday. If nothing surprises us, the whole migration is finished inside six weeks. The risk I am watching is the billing window slipping, because everything after it depends on it. I will flag it the moment that looks likely rather than at the end.`,
  },
  {
    id: 'present-closing-summary',
    title: 'Closing summary',
    kind: 'presentation',
    mode: 'read_aloud',
    focus:
      'Endings get rushed. Read the last sentence at the same speed as the first one, then stop rather than trailing off.',
    text: `So, three things to take away. First, the problem is smaller than it looked in March, and we now have numbers rather than guesses. Second, the fix is mostly work we were going to do anyway, which is why I am not asking for a bigger budget. Third, I need a decision on the billing window by Friday, and after that the plan runs itself. That is everything from me. I am happy to go back over any of it.`,
  },
  {
    id: 'present-thirty-second-pitch',
    title: 'Your own thirty-second pitch',
    kind: 'presentation',
    mode: 'prompt',
    targetSeconds: 30,
    focus:
      'Your words, not a script, so GymOS cannot count them. What it can tell you is how long you took and where you stopped.',
    text: `Describe something you are working on to someone who has never heard of it, in about thirty seconds. One sentence on what it is, one on who it is for, one on why it is worth doing, and stop. Record it twice: once off the top of your head, once after deciding your first sentence.`,
  },

  /* ------------------------------------------------------------- interviews */
  {
    id: 'interview-about-yourself',
    title: '"Tell me about yourself"',
    kind: 'interview',
    mode: 'prompt',
    targetSeconds: 90,
    focus:
      'Aim for roughly ninety seconds. If you run long, the usual cause is starting too early in the story rather than speaking too fast.',
    text: `Answer out loud: tell me about yourself. Structure it however you like, but decide the structure before you start recording. A common one: where you are now, the two or three steps that got you there, and what you are looking for next. Finish on the last of those three rather than circling back.`,
  },
  {
    id: 'interview-disagreement',
    title: '"Tell me about a disagreement"',
    kind: 'interview',
    mode: 'prompt',
    targetSeconds: 120,
    focus:
      'A two-minute answer about a real event. Watch for the long pause in the middle where you look for the next fact.',
    text: `Answer out loud: describe a time you disagreed with a decision at work or at school, and what you did about it. Say what the decision was, what you thought instead, what you actually said or did, and how it ended, including if it ended with you being wrong. Keep the other person anonymous.`,
  },
  {
    id: 'interview-why-this-role',
    title: '"Why this role?"',
    kind: 'interview',
    mode: 'prompt',
    targetSeconds: 60,
    focus:
      'Short on purpose. A minute is plenty, and the discipline is stopping once you have answered.',
    text: `Answer out loud: why this role, and why now? Name the specific thing about the work that you want, not the company's reputation. One minute. If you reach the end of your reasons before the minute is up, stop there; a short complete answer is better than a long one padded out.`,
  },

  /* ----------------------------------------------------------- conversations */
  {
    id: 'convo-missed-deadline',
    title: 'Raising a missed deadline',
    kind: 'conversation',
    mode: 'prompt',
    targetSeconds: 90,
    focus:
      'Rehearsing an opening you are dreading. The measurement that matters here is the pause before you start.',
    text: `Rehearse the first ninety seconds of a difficult conversation. A piece of work you were depending on is late and you need to raise it with the person responsible, who you will keep working with afterwards. Say your opening out loud, in full, including the first sentence. Describe what happened in facts rather than adjectives, say what you need, and then ask a real question and leave space for the answer. Record it again after you have heard the first take.`,
  },
  {
    id: 'convo-declining-request',
    title: 'Declining a request',
    kind: 'conversation',
    mode: 'prompt',
    targetSeconds: 45,
    focus:
      'Short, complete, and finished. Many people fill the silence after a refusal; see whether you do.',
    text: `Say no, out loud, to a request you would normally agree to. Give the answer in your first sentence rather than building up to it, add the one reason that is actually true, offer an alternative only if you mean it, and then stop talking. Forty-five seconds is more than enough.`,
  },

  /* ----------------------------------------------------------- free speaking */
  {
    id: 'free-explain-something',
    title: 'Explain something you know well',
    kind: 'free_speaking',
    mode: 'prompt',
    targetSeconds: 120,
    focus:
      'No script, so no word count and no words-per-minute. Duration, silence and pauses are still measured from the audio.',
    text: `Pick something you understand well and explain it for two minutes to someone who knows nothing about it. No notes. Start with why it matters rather than what it is called. When you catch yourself using a term you have not explained, stop and explain it, then carry on; the pause count will show you how often that happened.`,
  },
];

export const VOICE_SCRIPTS: VoiceScript[] = SEEDS.map((seed) => {
  const wordCount = countWords(seed.text);
  const estimatedSeconds =
    seed.mode === 'read_aloud'
      ? Math.max(5, Math.round((wordCount / REFERENCE_READING_WPM) * 60))
      : (seed.targetSeconds ?? 60);
  const provenance = seed.provenance ?? 'original';
  if (provenance !== 'original' && !seed.provenanceSource) {
    throw new Error(
      `voice script ${seed.id}: provenance '${provenance}' needs a provenanceSource naming the work it came from.`,
    );
  }
  return {
    id: seed.id,
    title: seed.title,
    kind: seed.kind,
    mode: seed.mode,
    text: seed.text,
    focus: seed.focus,
    wordCount,
    spokenWordCount: seed.mode === 'read_aloud' ? wordCount : null,
    estimatedSeconds,
    provenance,
    provenanceSource: seed.provenanceSource ?? null,
  };
});

export const VOICE_SCRIPT_BY_ID: Map<string, VoiceScript> = new Map(
  VOICE_SCRIPTS.map((script) => [script.id, script]),
);

export function scriptsForKind(kind: VoiceScriptKind): VoiceScript[] {
  return VOICE_SCRIPTS.filter((script) => script.kind === kind);
}
