/**
 * Outfit engine — colour, formality and weather only.
 *
 * PURE: no I/O, no database, no imports from services, no network. Everything it
 * knows about colour is the hard-coded table below, so it works offline forever
 * and needs no shopping API.
 *
 * WHAT THIS ENGINE DELIBERATELY DOES NOT DO
 * -----------------------------------------
 * It contains no body-shape rules, no "flattering"/"slimming"/"hides" logic, no
 * gendered rules about who may wear a garment, and no rating of anyone's
 * appearance. It never looks at a photograph and never estimates anything about
 * a body. Three reasons:
 *   1. Such rules are not measurable. There is no honest way to compute how a
 *      garment "suits a body" from a wardrobe record, so any score would be
 *      invented, and GymOS does not invent numbers.
 *   2. They cause harm. Appearance scoring and "fix your flaws" styling advice
 *      feed body-image problems, and shipping it to someone tracking food and
 *      training would be reckless.
 *   3. They are unnecessary. Colour harmony, formality level and warmth are real,
 *      checkable properties of the clothes themselves, and they are what actually
 *      makes an outfit work for an occasion.
 * Garment categories below are listed as garments, never grouped by gender.
 */

import { hashSeed, mulberry32 } from './rng';

/* ------------------------------------------------------------------- colour */

export type ColourKey =
  | 'white' | 'cream' | 'beige' | 'tan' | 'brown' | 'grey' | 'charcoal' | 'black'
  | 'navy' | 'denim' | 'blue' | 'sky' | 'teal' | 'mint' | 'green' | 'forest'
  | 'olive' | 'mustard' | 'yellow' | 'orange' | 'rust' | 'red' | 'maroon'
  | 'pink' | 'blush' | 'purple' | 'lavender';

export interface ColourEntry {
  key: ColourKey;
  label: string;
  /** Degrees on the colour wheel, or null for an achromatic colour (white/grey/black). */
  hue: number | null;
  /** Saturation and lightness, 0-100. Approximate by design: these are garment colours. */
  saturation: number;
  lightness: number;
  /**
   * Neutral in the wardrobe sense: it sits with almost anything. Navy, denim and
   * olive are included because in practice they behave like neutrals even though
   * they are not achromatic.
   */
  neutral: boolean;
  aliases: string[];
}

/**
 * The whole colour model. A compact table instead of a dependency: 27 garment
 * colours with approximate hue/saturation/lightness and the common names people
 * actually type.
 */
export const COLOUR_TABLE: ColourEntry[] = [
  { key: 'white', label: 'white', hue: null, saturation: 0, lightness: 97, neutral: true, aliases: ['off white', 'offwhite', 'ivory', 'snow', 'optic white'] },
  { key: 'cream', label: 'cream', hue: 45, saturation: 30, lightness: 92, neutral: true, aliases: ['ecru', 'vanilla', 'bone'] },
  { key: 'beige', label: 'beige', hue: 36, saturation: 25, lightness: 80, neutral: true, aliases: ['sand', 'oatmeal', 'stone', 'nude'] },
  { key: 'tan', label: 'tan', hue: 30, saturation: 35, lightness: 62, neutral: true, aliases: ['camel', 'khaki', 'biscuit', 'caramel'] },
  { key: 'brown', label: 'brown', hue: 25, saturation: 40, lightness: 32, neutral: true, aliases: ['chocolate', 'coffee', 'walnut', 'mocha'] },
  { key: 'grey', label: 'grey', hue: null, saturation: 0, lightness: 55, neutral: true, aliases: ['gray', 'silver', 'ash', 'heather grey', 'heather gray'] },
  { key: 'charcoal', label: 'charcoal', hue: null, saturation: 0, lightness: 25, neutral: true, aliases: ['graphite', 'slate grey', 'slate gray', 'gunmetal'] },
  { key: 'black', label: 'black', hue: null, saturation: 0, lightness: 8, neutral: true, aliases: ['jet black', 'onyx'] },
  { key: 'navy', label: 'navy', hue: 220, saturation: 60, lightness: 22, neutral: true, aliases: ['navy blue', 'midnight blue', 'ink', 'midnight'] },
  { key: 'denim', label: 'denim', hue: 215, saturation: 35, lightness: 45, neutral: true, aliases: ['indigo', 'chambray', 'jeans', 'washed denim'] },
  { key: 'blue', label: 'blue', hue: 215, saturation: 70, lightness: 50, neutral: false, aliases: ['royal blue', 'cobalt'] },
  { key: 'sky', label: 'sky blue', hue: 200, saturation: 65, lightness: 75, neutral: false, aliases: ['sky', 'powder blue', 'pale blue', 'baby blue'] },
  { key: 'teal', label: 'teal', hue: 180, saturation: 55, lightness: 40, neutral: false, aliases: ['turquoise', 'aqua', 'cyan', 'peacock'] },
  { key: 'mint', label: 'mint', hue: 150, saturation: 45, lightness: 80, neutral: false, aliases: ['pistachio', 'sea green', 'pale green'] },
  { key: 'green', label: 'green', hue: 130, saturation: 55, lightness: 40, neutral: false, aliases: ['emerald', 'grass green', 'kelly green'] },
  { key: 'forest', label: 'forest green', hue: 145, saturation: 45, lightness: 22, neutral: false, aliases: ['bottle green', 'pine', 'hunter green'] },
  { key: 'olive', label: 'olive', hue: 75, saturation: 40, lightness: 35, neutral: true, aliases: ['army green', 'khaki green', 'sage', 'moss'] },
  { key: 'mustard', label: 'mustard', hue: 45, saturation: 70, lightness: 50, neutral: false, aliases: ['ochre', 'turmeric', 'honey'] },
  { key: 'yellow', label: 'yellow', hue: 52, saturation: 85, lightness: 60, neutral: false, aliases: ['lemon', 'butter'] },
  { key: 'orange', label: 'orange', hue: 28, saturation: 85, lightness: 55, neutral: false, aliases: ['tangerine', 'amber', 'marigold'] },
  { key: 'rust', label: 'rust', hue: 18, saturation: 60, lightness: 42, neutral: false, aliases: ['terracotta', 'brick', 'burnt orange'] },
  { key: 'red', label: 'red', hue: 2, saturation: 75, lightness: 45, neutral: false, aliases: ['scarlet', 'cherry', 'crimson'] },
  { key: 'maroon', label: 'maroon', hue: 350, saturation: 55, lightness: 25, neutral: false, aliases: ['burgundy', 'wine', 'oxblood'] },
  { key: 'pink', label: 'pink', hue: 340, saturation: 70, lightness: 70, neutral: false, aliases: ['rose', 'fuchsia'] },
  { key: 'blush', label: 'blush', hue: 10, saturation: 45, lightness: 85, neutral: false, aliases: ['peach', 'pale pink'] },
  { key: 'purple', label: 'purple', hue: 280, saturation: 50, lightness: 45, neutral: false, aliases: ['violet', 'plum', 'aubergine'] },
  { key: 'lavender', label: 'lavender', hue: 270, saturation: 40, lightness: 80, neutral: false, aliases: ['lilac', 'mauve'] },
];

const COLOUR_LOOKUP: Map<string, ColourEntry> = (() => {
  const map = new Map<string, ColourEntry>();
  for (const entry of COLOUR_TABLE) {
    map.set(entry.key, entry);
    map.set(entry.label, entry);
    for (const alias of entry.aliases) map.set(alias, entry);
  }
  return map;
})();

/** Modifiers people type in front of a colour, and what they do to lightness. */
const LIGHTNESS_MODIFIERS: { word: string; delta: number }[] = [
  { word: 'dark', delta: -18 },
  { word: 'deep', delta: -18 },
  { word: 'light', delta: 18 },
  { word: 'pale', delta: 22 },
  { word: 'bright', delta: 6 },
  { word: 'muted', delta: 0 },
];

export interface ParsedColour {
  key: ColourKey;
  label: string;
  hue: number | null;
  saturation: number;
  lightness: number;
  neutral: boolean;
  /** Exactly what the wearer typed, kept so nothing is silently rewritten. */
  raw: string;
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses a stored colour name into the model. Returns null when the name is not
 * in the table — an unrecognised colour is reported as unrecognised, never guessed.
 */
export function parseColour(raw: string): ParsedColour | null {
  const text = normalise(raw);
  if (!text) return null;

  const direct = COLOUR_LOOKUP.get(text);
  if (direct) return toParsed(direct, raw, 0);

  const tokens = text.split(' ');
  // "dark olive", "pale blue": a modifier plus a colour we know.
  for (const modifier of LIGHTNESS_MODIFIERS) {
    if (!tokens.includes(modifier.word)) continue;
    const rest = tokens.filter((t) => t !== modifier.word).join(' ');
    const entry = COLOUR_LOOKUP.get(rest);
    if (entry) return toParsed(entry, raw, modifier.delta);
  }
  // Last resort: any single token that names a colour ("navy cotton twill").
  for (const token of tokens) {
    const entry = COLOUR_LOOKUP.get(token);
    if (entry) return toParsed(entry, raw, 0);
  }
  return null;
}

function toParsed(entry: ColourEntry, raw: string, lightnessDelta: number): ParsedColour {
  return {
    key: entry.key,
    label: entry.label,
    hue: entry.hue,
    saturation: entry.saturation,
    lightness: Math.min(98, Math.max(4, entry.lightness + lightnessDelta)),
    neutral: entry.neutral,
    raw,
  };
}

export type HarmonyKind =
  | 'neutral'
  | 'monochrome'
  | 'low_contrast_monochrome'
  | 'analogous'
  | 'complementary'
  | 'split'
  | 'unrelated'
  | 'unknown';

export interface HarmonyResult {
  kind: HarmonyKind;
  /**
   * 0-1. A colour-relationship score only; it says nothing about a person.
   *
   * null when the pairing could not be scored, because one of the colour names
   * is not in the table above. An unscored pairing stays unscored: there is no
   * stand-in value, because a stand-in would be a number GymOS invented and
   * then presented as a measurement.
   */
  score: number | null;
  explanation: string;
}

/**
 * Every harmony that has a score. 'unknown' is deliberately absent: it is the
 * absence of a comparison, so there is nothing to look up for it.
 */
const HARMONY_SCORES: Record<Exclude<HarmonyKind, 'unknown'>, number> = {
  neutral: 0.9,
  monochrome: 0.85,
  low_contrast_monochrome: 0.55,
  analogous: 0.8,
  complementary: 0.75,
  split: 0.62,
  unrelated: 0.38,
};

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function result(kind: Exclude<HarmonyKind, 'unknown'>, explanation: string): HarmonyResult {
  return { kind, score: HARMONY_SCORES[kind], explanation };
}

/** A pairing GymOS cannot compare. It carries no score, not a substitute one. */
function unscored(explanation: string): HarmonyResult {
  return { kind: 'unknown', score: null, explanation };
}

/**
 * Scores one pair of colours by established colour-harmony relationships.
 * Order matters: neutrals first (they dominate real wardrobes), then same-hue,
 * then wheel distance.
 */
export function colourHarmony(
  a: ParsedColour | null,
  b: ParsedColour | null,
): HarmonyResult {
  if (!a || !b) {
    return unscored(
      'GymOS does not recognise one of these colour names, so it did not score this pairing.',
    );
  }

  if (a.neutral && b.neutral) {
    return result(
      'neutral',
      `${a.label} and ${b.label} are both neutrals, so they sit together without competing.`,
    );
  }
  if (a.neutral || b.neutral) {
    const neutral = a.neutral ? a : b;
    const other = a.neutral ? b : a;
    return result(
      'neutral',
      `${neutral.label} is a neutral, so it pairs with ${other.label} and lets that colour lead.`,
    );
  }

  if (a.hue === null || b.hue === null) {
    // Achromatic colours are all marked neutral above; this is defensive only.
    return result('neutral', `${a.label} and ${b.label} read as a neutral pairing.`);
  }

  const distance = hueDistance(a.hue, b.hue);
  const lightnessGap = Math.abs(a.lightness - b.lightness);

  if (distance <= 15) {
    if (lightnessGap >= 18) {
      return result(
        'monochrome',
        `${a.label} and ${b.label} are two tones of one colour with ${Math.round(lightnessGap)} points of light-to-dark contrast, which reads as deliberate.`,
      );
    }
    return result(
      'low_contrast_monochrome',
      `${a.label} and ${b.label} are nearly the same tone, so the two pieces read as one block with very little contrast.`,
    );
  }
  if (distance <= 45) {
    return result(
      'analogous',
      `${a.label} and ${b.label} are neighbours on the colour wheel, which is a quiet, easy pairing.`,
    );
  }
  if (distance >= 150) {
    return result(
      'complementary',
      `${a.label} and ${b.label} sit opposite each other on the colour wheel — a strong, intentional contrast.`,
    );
  }
  if (distance >= 100) {
    return result(
      'split',
      `${a.label} and ${b.label} are a wide-angle pairing: more contrast than a quiet outfit, less than a direct opposite.`,
    );
  }
  return result(
    'unrelated',
    `${a.label} and ${b.label} are close enough on the wheel to clash rather than contrast.`,
  );
}

/* -------------------------------------------------------------------- slots */

export const OUTFIT_SLOTS = ['top', 'bottom', 'footwear', 'layer', 'accessory', 'one_piece'] as const;
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number];

/**
 * Garment category -> slot. Listed as garments; no category is tied to a gender,
 * and nothing here is a rule about who may wear what.
 */
const CATEGORY_SLOTS: Record<string, OutfitSlot> = {
  top: 'top', shirt: 'top', 't shirt': 'top', tshirt: 'top', tee: 'top', polo: 'top',
  blouse: 'top', kurta: 'top', vest: 'top', tank: 'top', jersey: 'top', 'crop top': 'top',
  bottom: 'bottom', trousers: 'bottom', pants: 'bottom', jeans: 'bottom', chinos: 'bottom',
  shorts: 'bottom', skirt: 'bottom', joggers: 'bottom', 'track pants': 'bottom',
  leggings: 'bottom', pyjamas: 'bottom', salwar: 'bottom', palazzo: 'bottom', lungi: 'bottom',
  footwear: 'footwear', shoes: 'footwear', sneakers: 'footwear', trainers: 'footwear',
  boots: 'footwear', sandals: 'footwear', loafers: 'footwear', chappals: 'footwear',
  slippers: 'footwear', flats: 'footwear', heels: 'footwear', runners: 'footwear',
  layer: 'layer', jacket: 'layer', blazer: 'layer', coat: 'layer', sweater: 'layer',
  jumper: 'layer', hoodie: 'layer', cardigan: 'layer', overshirt: 'layer', shacket: 'layer',
  sweatshirt: 'layer', waistcoat: 'layer', gilet: 'layer', shrug: 'layer',
  accessory: 'accessory', belt: 'accessory', watch: 'accessory', cap: 'accessory',
  hat: 'accessory', scarf: 'accessory', bag: 'accessory', socks: 'accessory',
  tie: 'accessory', sunglasses: 'accessory', jewellery: 'accessory', jewelry: 'accessory',
  stole: 'accessory', dupatta: 'accessory', bandana: 'accessory', gloves: 'accessory',
  beanie: 'accessory',
  dress: 'one_piece', jumpsuit: 'one_piece', dungarees: 'one_piece', overalls: 'one_piece',
  saree: 'one_piece', sari: 'one_piece', gown: 'one_piece', romper: 'one_piece',
  'kurta set': 'one_piece', 'salwar kameez': 'one_piece', robe: 'one_piece', abaya: 'one_piece',
};

/** Resolves a free-text category to a slot, or null when it is not recognised. */
export function slotForCategory(category: string): OutfitSlot | null {
  const text = normalise(category);
  if (!text) return null;
  const direct = CATEGORY_SLOTS[text];
  if (direct) return direct;
  for (const token of text.split(' ')) {
    const hit = CATEGORY_SLOTS[token];
    if (hit) return hit;
  }
  return null;
}

/** Every category the slot map knows, grouped by slot, for building a picker. */
export const CATEGORY_OPTIONS: { slot: OutfitSlot; categories: string[] }[] = OUTFIT_SLOTS.map(
  (slot) => ({
    slot,
    categories: Object.keys(CATEGORY_SLOTS)
      .filter((category) => CATEGORY_SLOTS[category] === slot)
      .sort((a, b) => a.localeCompare(b)),
  }),
);

/**
 * The checkbox set an edit form must render for a tag group, and which boxes
 * start ticked: every tag the app offers, plus any tag already on the record
 * that the offered list does not contain.
 *
 * Needed because a checkbox group submits nothing for a box it never rendered,
 * which is indistinguishable from a box the wearer cleared. A form that offered
 * only its own fixed list would therefore erase a tag outside that list — an
 * imported one, or one from an older build — the moment the item was saved. The
 * category picker keeps its own value for exactly this reason; tags need the
 * same treatment. Pure: it only reshuffles the strings it is given.
 */
export function tagCheckboxes(
  offered: readonly string[],
  stored: readonly string[],
): { tag: string; checked: boolean }[] {
  const out: { tag: string; checked: boolean }[] = offered.map((tag) => ({
    tag,
    checked: stored.includes(tag),
  }));
  for (const tag of stored) {
    if (!out.some((option) => option.tag === tag)) out.push({ tag, checked: true });
  }
  return out;
}

/* ------------------------------------------------- occasion and weather bands */

export const OCCASIONS = ['active', 'casual', 'work', 'formal'] as const;
export type Occasion = (typeof OCCASIONS)[number];

export const WEATHER_BANDS = ['cold', 'mild', 'warm', 'hot'] as const;
export type WeatherBand = (typeof WEATHER_BANDS)[number];

/** Formality is a 1-5 scale the wearer sets per item. These are the targets. */
const OCCASION_FORMALITY: Record<Occasion, number> = { active: 1, casual: 2, work: 4, formal: 5 };

export const OCCASION_LABELS: Record<Occasion, string> = {
  active: 'training or sport',
  casual: 'casual',
  work: 'work',
  formal: 'formal',
};

/** Warmth is a 1-5 scale the wearer sets per item. These are the targets. */
const WEATHER_WARMTH: Record<WeatherBand, number> = { cold: 4.5, mild: 3, warm: 2, hot: 1 };

export const WEATHER_LABELS: Record<WeatherBand, string> = {
  cold: 'a cold day',
  mild: 'a mild day',
  warm: 'a warm day',
  hot: 'a hot day',
};

/** Season tags that are consistent with each weather band. */
const WEATHER_SEASONS: Record<WeatherBand, string[]> = {
  cold: ['winter', 'all', 'all season', 'any'],
  mild: ['spring', 'autumn', 'fall', 'monsoon', 'all', 'all season', 'any'],
  warm: ['spring', 'summer', 'all', 'all season', 'any'],
  hot: ['summer', 'all', 'all season', 'any'],
};

export function normaliseOccasion(value: string): Occasion {
  const text = normalise(value);
  if (text === 'work' || text === 'office' || text === 'business' || text === 'smart') return 'work';
  if (text === 'formal' || text === 'wedding' || text === 'event' || text === 'black tie') return 'formal';
  if (text === 'active' || text === 'gym' || text === 'workout' || text === 'sport' || text === 'training') return 'active';
  return 'casual';
}

export function normaliseWeather(value: string): WeatherBand {
  const text = normalise(value);
  return (WEATHER_BANDS as readonly string[]).includes(text) ? (text as WeatherBand) : 'mild';
}

/* ------------------------------------------------------------------- scoring */

export interface OutfitItem {
  id: string;
  name: string;
  /** Free text as the wearer typed it; mapped to a slot by slotForCategory. */
  category: string;
  /** Colour names as recorded by the wearer. The first is treated as dominant. */
  colours: string[];
  /** 1-5, self-reported by the wearer. Not a judgement of anything. */
  formality: number;
  /** 1-5, self-reported by the wearer: how warm the garment is. */
  warmth: number;
  occasionTags: string[];
  seasonTags: string[];
  favourite: boolean;
  /** In the wash or awaiting repair: left out of suggestions. */
  needsCare: boolean;
}

export interface OutfitContext {
  occasion: Occasion;
  weather: WeatherBand;
  excludeItemIds?: string[];
  limit?: number;
  /** Any string: the same seed and the same wardrobe always give the same order. */
  seed?: string | number;
  includeAccessory?: boolean;
}

export interface OutfitSlotPick {
  slot: OutfitSlot;
  itemId: string;
  itemName: string;
  colourLabel: string | null;
}

export interface OutfitSuggestion {
  /** Stable signature of the item set; the same set always has the same key. */
  key: string;
  itemIds: string[];
  picks: OutfitSlotPick[];
  /**
   * 0-1 composite of colour harmony, formality match and weather suitability.
   * When colour could not be scored at all, its weight is dropped and the other
   * two are renormalised, so the composite is formality and warmth only. It
   * never folds in a filled-in colour value to keep the arithmetic tidy.
   */
  score: number;
  /** 0-1 colour harmony, or null when no pairing in this set could be compared. */
  colourScore: number | null;
  /** Why colour is unscored, in plain words. Null whenever colourScore is a number. */
  colourScoreNote: string | null;
  /**
   * How many of this set's pairings carried a colour score, out of how many
   * pairings it has at all. Reported so a caller that quotes colourScore can
   * say what it covers: a score measured from two of five pairings is a real
   * number about two pairings, not about the outfit as a whole.
   */
  colourPairsScored: number;
  colourPairsTotal: number;
  formalityScore: number;
  weatherScore: number;
  /** Required slots the wardrobe could not fill. Stated, never hidden. */
  missingSlots: OutfitSlot[];
  /** Why this works, in plain words. Always at least one line. */
  explanation: string[];
  summary: string;
}

const WEIGHTS = { colour: 0.4, formality: 0.35, weather: 0.25 };

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function dominantColour(item: OutfitItem): ParsedColour | null {
  for (const raw of item.colours) {
    const parsed = parseColour(raw);
    if (parsed) return parsed;
  }
  return null;
}

function formalityFit(item: OutfitItem, occasion: Occasion): number {
  const target = OCCASION_FORMALITY[occasion];
  return clamp01(1 - Math.abs(clampScale(item.formality) - target) / 4);
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, value));
}

function seasonConsistent(item: OutfitItem, weather: WeatherBand): boolean {
  if (item.seasonTags.length === 0) return true;
  const allowed = WEATHER_SEASONS[weather];
  return item.seasonTags.some((tag) => allowed.includes(normalise(tag)));
}

function weatherFit(item: OutfitItem, weather: WeatherBand): number {
  const target = WEATHER_WARMTH[weather];
  const base = clamp01(1 - Math.abs(clampScale(item.warmth) - target) / 4);
  return seasonConsistent(item, weather) ? base : base * 0.5;
}

function occasionTagged(item: OutfitItem, occasion: Occasion): boolean {
  return item.occasionTags.some((tag) => normaliseOccasion(tag) === occasion);
}

/** Per-item fit used to rank candidates before combining them. */
function itemFit(item: OutfitItem, ctx: OutfitContext): number {
  const tagBonus = occasionTagged(item, ctx.occasion) ? 0.06 : 0;
  const favouriteBonus = item.favourite ? 0.03 : 0;
  return (
    0.55 * formalityFit(item, ctx.occasion) +
    0.45 * weatherFit(item, ctx.weather) +
    tagBonus +
    favouriteBonus
  );
}

/** Tiny deterministic jitter, only ever large enough to break an exact tie. */
function tieBreak(seed: string | number, key: string): number {
  return mulberry32(hashSeed(String(seed), key))() * 1e-6;
}

export const SLOT_LABELS: Record<OutfitSlot, string> = {
  top: 'top',
  bottom: 'bottom',
  footwear: 'footwear',
  layer: 'layer',
  accessory: 'accessory',
  one_piece: 'one-piece',
};

interface Scored {
  items: OutfitItem[];
  /** Mean over the pairs that could be compared, or null when none could be. */
  colour: number | null;
  /** How many pairs carried a score, out of how many pairs the set has at all. */
  colourPairsScored: number;
  colourPairsTotal: number;
  formality: number;
  weather: number;
  total: number;
  pairs: { a: OutfitItem; b: OutfitItem; harmony: HarmonyResult }[];
}

/**
 * Why a combination carries no colour score, in plain words; null when it does
 * carry one. This states that there is no score and why — it is not a score.
 */
function colourNote(scored: Scored): string | null {
  if (scored.colour !== null) return null;
  if (scored.colourPairsTotal === 0) {
    return 'Colour is not scored for this combination: it is a single garment, so there is no pairing to compare.';
  }
  return 'Colour is not scored for this combination: no pairing in it uses two colour names GymOS recognises, so the match is formality and warmth only.';
}

function scoreSet(items: OutfitItem[], ctx: OutfitContext): Scored {
  const pairs: Scored['pairs'] = [];
  let colourTotal = 0;
  let scoredPairs = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (!a || !b) continue;
      const harmony = colourHarmony(dominantColour(a), dominantColour(b));
      pairs.push({ a, b, harmony });
      // A pairing with no score contributes nothing to the mean — neither a
      // stand-in value nor a denominator it did not earn.
      if (harmony.score !== null) {
        colourTotal += harmony.score;
        scoredPairs += 1;
      }
    }
  }
  const colour = scoredPairs > 0 ? colourTotal / scoredPairs : null;
  const formality =
    items.reduce((sum, item) => sum + formalityFit(item, ctx.occasion), 0) / Math.max(1, items.length);
  const weather =
    items.reduce((sum, item) => sum + weatherFit(item, ctx.weather), 0) / Math.max(1, items.length);
  const tagged = items.filter((item) => occasionTagged(item, ctx.occasion)).length;
  const tagBonus = items.length > 0 ? 0.04 * (tagged / items.length) : 0;
  // Colour only carries weight when it was measured. With no colour score the
  // remaining weights are renormalised, which ranks on what the record does say
  // instead of borrowing a number for the part it does not.
  const weighted =
    WEIGHTS.formality * formality +
    WEIGHTS.weather * weather +
    (colour === null ? 0 : WEIGHTS.colour * colour);
  const weightSum = WEIGHTS.formality + WEIGHTS.weather + (colour === null ? 0 : WEIGHTS.colour);
  return {
    items,
    colour,
    colourPairsScored: scoredPairs,
    colourPairsTotal: pairs.length,
    formality,
    weather,
    total: clamp01(weighted / weightSum + tagBonus),
    pairs,
  };
}

function explain(scored: Scored, ctx: OutfitContext, missingSlots: OutfitSlot[]): string[] {
  const lines: string[] = [];

  // Colour: lead with the clearest relationship, then the weakest if it is weak.
  // Only pairings that carry a score are ranked — an unscored pairing has no
  // place in a ranking of relationships.
  const comparable = scored.pairs
    .flatMap((pair) => (pair.harmony.score === null ? [] : [{ pair, score: pair.harmony.score }]))
    .sort((a, b) => b.score - a.score);
  const best = comparable[0];
  const worst = comparable[comparable.length - 1];
  if (best) lines.push(best.pair.harmony.explanation);
  if (worst && worst !== best && worst.score < 0.6) lines.push(worst.pair.harmony.explanation);

  const unreadable = scored.items.filter((item) => dominantColour(item) === null);
  if (unreadable.length > 0) {
    lines.push(
      `Colour matching skipped ${unreadable.map((i) => i.name).join(', ')}: ${unreadable.length === 1 ? 'its colour name is' : 'their colour names are'} not in the GymOS colour table.`,
    );
  }
  const note = colourNote(scored);
  if (note) {
    lines.push(note);
  } else if (scored.colourPairsScored < scored.colourPairsTotal) {
    lines.push(
      `The colour match covers the ${scored.colourPairsScored} of ${scored.colourPairsTotal} pairings GymOS could compare; the rest are not counted either way.`,
    );
  }

  // Formality.
  const target = OCCASION_FORMALITY[ctx.occasion];
  const levels = scored.items.map((item) => clampScale(item.formality));
  const spread = Math.max(...levels) - Math.min(...levels);
  if (scored.formality >= 0.85 && spread <= 1) {
    lines.push(
      `Every piece is recorded at about the same formality level, which is the level you set for ${OCCASION_LABELS[ctx.occasion]}.`,
    );
  } else if (spread >= 2) {
    lines.push(
      `The formality levels you recorded span ${spread} steps, so this is a mixed-register outfit rather than a uniform one.`,
    );
  } else {
    const direction = levels.reduce((s, l) => s + l, 0) / levels.length < target ? 'below' : 'above';
    lines.push(
      `On your own 1-5 formality scale this sits slightly ${direction} the level you set for ${OCCASION_LABELS[ctx.occasion]}.`,
    );
  }

  // Weather.
  const hasLayer = scored.items.some((item) => slotForCategory(item.category) === 'layer');
  if (scored.weather >= 0.8) {
    lines.push(
      `The warmth you recorded for these pieces suits ${WEATHER_LABELS[ctx.weather]}${hasLayer ? ', and the layer is there if it turns' : ''}.`,
    );
  } else {
    lines.push(
      `Warmth is only an approximate match for ${WEATHER_LABELS[ctx.weather]} — these are the closest pieces your wardrobe has.`,
    );
  }

  const offSeason = scored.items.filter((item) => !seasonConsistent(item, ctx.weather));
  if (offSeason.length > 0) {
    lines.push(
      `You tagged ${offSeason.map((i) => i.name).join(', ')} for a different season, so this is outside the season you recorded.`,
    );
  }

  if (missingSlots.length > 0) {
    lines.push(
      `Your wardrobe has nothing recorded for: ${missingSlots.map((s) => SLOT_LABELS[s]).join(', ')}. This suggestion covers only what you have listed.`,
    );
  }

  return lines;
}

function summarise(scored: Scored, ctx: OutfitContext): string {
  const names = scored.items.map((item) => item.name);
  const lead = names.slice(0, 2).join(' with ');
  const rest = names.length > 2 ? `, plus ${names.slice(2).join(' and ')}` : '';
  return `${lead}${rest} — put together for ${OCCASION_LABELS[ctx.occasion]} on ${WEATHER_LABELS[ctx.weather]}.`;
}

/** How many candidates per slot are considered. Keeps the search bounded. */
const CANDIDATE_CAP = 10;

function sortedCandidates(items: OutfitItem[], ctx: OutfitContext): OutfitItem[] {
  return [...items]
    .sort((a, b) => {
      const diff = itemFit(b, ctx) - itemFit(a, ctx);
      if (Math.abs(diff) > 1e-9) return diff;
      return a.id.localeCompare(b.id);
    })
    .slice(0, CANDIDATE_CAP);
}

/**
 * Suggests outfits for an occasion and a weather band.
 *
 * Deterministic: the same items, context and seed always produce the same list,
 * in the same order. Scoring is colour harmony, formality match and weather
 * suitability — nothing else, and nothing about the wearer.
 */
export function suggestOutfits(items: OutfitItem[], ctx: OutfitContext): OutfitSuggestion[] {
  const excluded = new Set(ctx.excludeItemIds ?? []);
  const limit = Math.max(1, Math.min(12, ctx.limit ?? 4));
  const seed = ctx.seed ?? `${ctx.occasion}:${ctx.weather}`;
  const target = OCCASION_FORMALITY[ctx.occasion];

  const pool = items.filter((item) => {
    if (excluded.has(item.id)) return false;
    if (item.needsCare) return false;
    if (slotForCategory(item.category) === null) return false;
    // Keep the search to pieces within two steps of the formality level the
    // wearer set for this occasion; anything further out is reported as a gap.
    return Math.abs(clampScale(item.formality) - target) <= 2;
  });

  const bySlot = (slot: OutfitSlot): OutfitItem[] =>
    pool.filter((item) => slotForCategory(item.category) === slot);

  const tops = sortedCandidates(bySlot('top'), ctx);
  const bottoms = sortedCandidates(bySlot('bottom'), ctx);
  const onePieces = sortedCandidates(bySlot('one_piece'), ctx);
  const footwear = sortedCandidates(bySlot('footwear'), ctx);
  const layers = sortedCandidates(bySlot('layer'), ctx);
  const accessories = sortedCandidates(bySlot('accessory'), ctx);

  const missingSlots: OutfitSlot[] = [];
  if (footwear.length === 0) missingSlots.push('footwear');

  // A base covers the torso and legs: either a top with a bottom, or one piece.
  const bases: OutfitItem[][] = [];
  for (const top of tops) {
    for (const bottom of bottoms) bases.push([top, bottom]);
  }
  for (const piece of onePieces) bases.push([piece]);

  if (bases.length === 0) return [];

  const layerWanted = ctx.weather === 'cold' || ctx.weather === 'mild';
  const wantAccessory = ctx.includeAccessory ?? true;

  const candidates: Scored[] = [];
  for (const base of bases) {
    let chosen = [...base];

    const addBest = (options: OutfitItem[], required: boolean) => {
      if (options.length === 0) return;
      const current = scoreSet(chosen, ctx).total;
      let bestItem: OutfitItem | null = null;
      let bestScore = -1;
      for (const option of options) {
        const score = scoreSet([...chosen, option], ctx).total;
        if (score > bestScore + 1e-9) {
          bestScore = score;
          bestItem = option;
        }
      }
      if (!bestItem) return;
      if (required || bestScore >= current - 0.02) chosen = [...chosen, bestItem];
    };

    addBest(footwear, true);
    if (layerWanted) addBest(layers, ctx.weather === 'cold');
    if (wantAccessory) addBest(accessories, false);

    candidates.push(scoreSet(chosen, ctx));
  }

  const seen = new Set<string>();
  const unique: { scored: Scored; key: string }[] = [];
  for (const candidate of candidates) {
    const key = candidate.items.map((i) => i.id).sort().join('+');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ scored: candidate, key });
  }

  unique.sort((a, b) => {
    const diff =
      b.scored.total + tieBreak(seed, b.key) - (a.scored.total + tieBreak(seed, a.key));
    if (Math.abs(diff) > 1e-12) return diff;
    return a.key.localeCompare(b.key);
  });

  // Variety: no single garment carries more than two of the suggestions, so the
  // list is not four versions of one outfit.
  const used = new Map<string, number>();
  const out: OutfitSuggestion[] = [];
  for (const { scored, key } of unique) {
    if (out.length >= limit) break;
    const overused = scored.items.some((item) => (used.get(item.id) ?? 0) >= 2);
    if (overused && unique.length > limit) continue;
    for (const item of scored.items) used.set(item.id, (used.get(item.id) ?? 0) + 1);
    out.push({
      key,
      itemIds: scored.items.map((i) => i.id),
      picks: scored.items.map((item) => ({
        slot: slotForCategory(item.category) ?? 'accessory',
        itemId: item.id,
        itemName: item.name,
        colourLabel: dominantColour(item)?.label ?? null,
      })),
      score: round2(scored.total),
      colourScore: scored.colour === null ? null : round2(scored.colour),
      colourScoreNote: colourNote(scored),
      colourPairsScored: scored.colourPairsScored,
      colourPairsTotal: scored.colourPairsTotal,
      formalityScore: round2(scored.formality),
      weatherScore: round2(scored.weather),
      missingSlots: [...missingSlots],
      explanation: explain(scored, ctx, missingSlots),
      summary: summarise(scored, ctx),
    });
  }
  return out;
}

/* --------------------------------------------------------------------- gaps */

export type GapKind = 'missing_slot' | 'formality_gap' | 'weather_gap' | 'unreadable_colour';

export interface WardrobeGap {
  kind: GapKind;
  slot?: OutfitSlot;
  occasion?: Occasion;
  weather?: WeatherBand;
  /** A factual statement about the wardrobe record. Never about the wearer. */
  message: string;
}

/**
 * What the recorded wardrobe cannot currently cover.
 *
 * Every message is a fact about the list of clothes — "nothing recorded at a
 * formal level" — and never a deficiency of the person who owns them. There is
 * no "you should buy", no ranking of the wardrobe and no judgement of taste.
 */
export function outfitGaps(items: OutfitItem[]): WardrobeGap[] {
  const gaps: WardrobeGap[] = [];
  const usable = items.filter((item) => slotForCategory(item.category) !== null);

  const inSlot = (slot: OutfitSlot) =>
    usable.filter((item) => slotForCategory(item.category) === slot);

  const hasBase = inSlot('one_piece').length > 0 || (inSlot('top').length > 0 && inSlot('bottom').length > 0);
  if (!hasBase) {
    for (const slot of ['top', 'bottom'] as const) {
      if (inSlot(slot).length === 0 && inSlot('one_piece').length === 0) {
        gaps.push({
          kind: 'missing_slot',
          slot,
          message: `No ${SLOT_LABELS[slot]} is recorded, so GymOS cannot assemble a complete outfit yet.`,
        });
      }
    }
  }
  if (inSlot('footwear').length === 0) {
    gaps.push({
      kind: 'missing_slot',
      slot: 'footwear',
      message: 'No footwear is recorded, so suggestions will cover clothes only.',
    });
  }

  for (const occasion of OCCASIONS) {
    const target = OCCASION_FORMALITY[occasion];
    const slots: OutfitSlot[] = ['top', 'bottom', 'footwear'];
    const unfilled = slots.filter((slot) => {
      const candidates = inSlot(slot).filter(
        (item) => Math.abs(clampScale(item.formality) - target) <= 1,
      );
      if (slot !== 'footwear' && inSlot('one_piece').some((item) => Math.abs(clampScale(item.formality) - target) <= 1)) {
        return false;
      }
      return candidates.length === 0;
    });
    if (unfilled.length > 0) {
      gaps.push({
        kind: 'formality_gap',
        occasion,
        message: `Nothing is recorded at a ${OCCASION_LABELS[occasion]} formality level for: ${unfilled.map((s) => SLOT_LABELS[s]).join(', ')}.`,
      });
    }
  }

  for (const weather of WEATHER_BANDS) {
    const target = WEATHER_WARMTH[weather];
    const matching = usable.filter(
      (item) => Math.abs(clampScale(item.warmth) - target) <= 1.5 && seasonConsistent(item, weather),
    );
    if (matching.length === 0) {
      gaps.push({
        kind: 'weather_gap',
        weather,
        message: `Nothing in the list is recorded with a warmth level for ${WEATHER_LABELS[weather]}.`,
      });
    }
  }

  const unreadable = items.filter(
    (item) => item.colours.length > 0 && dominantColour(item) === null,
  );
  if (unreadable.length > 0) {
    gaps.push({
      kind: 'unreadable_colour',
      message: `${unreadable.length} item${unreadable.length === 1 ? '' : 's'} use a colour name GymOS does not recognise, so colour matching skips ${unreadable.length === 1 ? 'it' : 'them'}: ${unreadable.map((i) => i.name).join(', ')}.`,
    });
  }

  const uncategorised = items.filter((item) => slotForCategory(item.category) === null);
  if (uncategorised.length > 0) {
    gaps.push({
      kind: 'missing_slot',
      message: `${uncategorised.length} item${uncategorised.length === 1 ? '' : 's'} have a category GymOS cannot map to a slot, so ${uncategorised.length === 1 ? 'it is' : 'they are'} left out of suggestions: ${uncategorised.map((i) => i.name).join(', ')}.`,
    });
  }

  return gaps;
}
