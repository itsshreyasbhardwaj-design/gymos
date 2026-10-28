/**
 * Outfit engine tests: colour-harmony correctness, determinism, filtering,
 * explanations, and the safety guarantee that no output judges a body.
 */
import { describe, it, expect } from 'vitest';
import {
  parseColour,
  colourHarmony,
  slotForCategory,
  suggestOutfits,
  outfitGaps,
  normaliseOccasion,
  normaliseWeather,
  tagCheckboxes,
  COLOUR_TABLE,
  CATEGORY_OPTIONS,
  OCCASIONS,
  WEATHER_BANDS,
  type OutfitItem,
  type OutfitContext,
} from '@/lib/engines/outfit';

const item = (over: Partial<OutfitItem> & { id: string }): OutfitItem => ({
  name: over.id,
  category: 'shirt',
  colours: ['navy'],
  formality: 2,
  warmth: 2,
  occasionTags: [],
  seasonTags: [],
  favourite: false,
  needsCare: false,
  ...over,
});

/** A small wardrobe that can dress every occasion and weather band. */
const wardrobe: OutfitItem[] = [
  item({ id: 'tee-white', name: 'White cotton tee', category: 't shirt', colours: ['white'], formality: 2, warmth: 1 }),
  item({ id: 'shirt-navy', name: 'Navy linen shirt', category: 'shirt', colours: ['navy'], formality: 3, warmth: 2 }),
  item({ id: 'shirt-white', name: 'White formal shirt', category: 'shirt', colours: ['white'], formality: 5, warmth: 2 }),
  item({ id: 'tee-mustard', name: 'Mustard tee', category: 't shirt', colours: ['mustard'], formality: 2, warmth: 1 }),
  item({ id: 'jeans-denim', name: 'Denim jeans', category: 'jeans', colours: ['denim'], formality: 2, warmth: 3 }),
  item({ id: 'chinos-tan', name: 'Tan chinos', category: 'chinos', colours: ['tan'], formality: 3, warmth: 2 }),
  item({ id: 'trousers-charcoal', name: 'Charcoal trousers', category: 'trousers', colours: ['charcoal'], formality: 5, warmth: 3 }),
  item({ id: 'shorts-olive', name: 'Olive shorts', category: 'shorts', colours: ['olive'], formality: 1, warmth: 1 }),
  item({ id: 'sneakers-white', name: 'White sneakers', category: 'sneakers', colours: ['white'], formality: 2, warmth: 2 }),
  item({ id: 'shoes-brown', name: 'Brown leather shoes', category: 'shoes', colours: ['brown'], formality: 4, warmth: 2 }),
  item({ id: 'coat-navy', name: 'Navy wool coat', category: 'coat', colours: ['navy'], formality: 4, warmth: 5, seasonTags: ['winter'] }),
  item({ id: 'jacket-denim', name: 'Denim jacket', category: 'jacket', colours: ['denim'], formality: 2, warmth: 3 }),
  item({ id: 'belt-brown', name: 'Brown belt', category: 'belt', colours: ['brown'], formality: 3, warmth: 1 }),
  item({ id: 'joggers-grey', name: 'Grey joggers', category: 'joggers', colours: ['grey'], formality: 1, warmth: 2 }),
  item({ id: 'vest-black', name: 'Black training vest', category: 'tank', colours: ['black'], formality: 1, warmth: 1 }),
  item({ id: 'runners-black', name: 'Black running shoes', category: 'runners', colours: ['black'], formality: 1, warmth: 2 }),
];

const ctx = (over: Partial<OutfitContext> = {}): OutfitContext => ({
  occasion: 'casual',
  weather: 'mild',
  seed: 'test-seed',
  ...over,
});

/* ------------------------------------------------------------------ colours */

describe('colour parsing', () => {
  it('resolves every canonical name, label and alias in the table', () => {
    for (const entry of COLOUR_TABLE) {
      expect(parseColour(entry.key)?.key).toBe(entry.key);
      expect(parseColour(entry.label)?.key).toBe(entry.key);
      for (const alias of entry.aliases) {
        expect(parseColour(alias)?.key, `alias ${alias}`).toBe(entry.key);
      }
    }
  });

  it('is case and punctuation insensitive', () => {
    expect(parseColour('  NAVY-Blue ')?.key).toBe('navy');
    expect(parseColour('Sky_Blue')?.key).toBe('sky');
  });

  it('applies lightness modifiers without changing the hue family', () => {
    const olive = parseColour('olive');
    const darkOlive = parseColour('dark olive');
    expect(darkOlive?.key).toBe('olive');
    expect(darkOlive!.lightness).toBeLessThan(olive!.lightness);
    const paleBlue = parseColour('pale sky blue');
    expect(paleBlue?.key).toBe('sky');
    expect(paleBlue!.lightness).toBeGreaterThan(parseColour('sky blue')!.lightness);
  });

  it('finds a known colour inside a longer description', () => {
    expect(parseColour('navy cotton twill')?.key).toBe('navy');
  });

  it('returns null rather than guessing an unknown colour', () => {
    expect(parseColour('zorblax')).toBeNull();
    expect(parseColour('')).toBeNull();
    expect(parseColour('   ')).toBeNull();
  });
});

describe('colour harmony relationships', () => {
  const h = (a: string, b: string) => colourHarmony(parseColour(a), parseColour(b));
  /** The score of a pairing that must be comparable; a null there is a bug, not a value. */
  const hs = (a: string, b: string): number => {
    const { score } = h(a, b);
    if (score === null) throw new Error(`${a} with ${b} should have been comparable`);
    return score;
  };

  it('treats a neutral as pairing with anything', () => {
    expect(h('navy', 'tan').kind).toBe('neutral');
    expect(h('white', 'mustard').kind).toBe('neutral');
    expect(h('black', 'white').kind).toBe('neutral');
    expect(h('navy', 'tan').explanation).toMatch(/neutral/i);
  });

  it('calls opposite hues complementary', () => {
    // Opposite by hue angle: blue 215 vs orange 28, red 2 vs teal 180.
    expect(h('blue', 'orange').kind).toBe('complementary');
    expect(h('red', 'teal').kind).toBe('complementary');
    // Purple sits 48 degrees off yellow's true opposite, so the engine must call
    // it a wide-angle pairing rather than overclaim a complementary one.
    expect(h('purple', 'yellow').kind).toBe('split');
  });

  it('calls neighbouring hues analogous', () => {
    expect(h('blue', 'teal').kind).toBe('analogous');
    expect(h('red', 'pink').kind).toBe('analogous');
  });

  it('separates monochrome with contrast from monochrome without it', () => {
    expect(h('sky blue', 'blue').kind).toBe('monochrome');
    expect(h('blue', 'royal blue').kind).toBe('low_contrast_monochrome');
    expect(hs('sky blue', 'blue')).toBeGreaterThan(hs('blue', 'royal blue'));
  });

  it('flags a mid-wheel pairing as a clash rather than a contrast', () => {
    // Mustard 45 and green 130: 85 degrees apart, too close to read as contrast.
    expect(h('mustard', 'green').kind).toBe('unrelated');
    expect(hs('mustard', 'green')).toBeLessThan(hs('blue', 'orange'));
    // Red and mustard are warm neighbours, so they are analogous, not a clash.
    expect(h('red', 'mustard').kind).toBe('analogous');
  });

  it('says so, rather than scoring, when a colour name is unknown', () => {
    const unknown = h('zorblax', 'navy');
    expect(unknown.kind).toBe('unknown');
    // No score at all — not a middling stand-in that would read as a measurement.
    expect(unknown.score).toBeNull();
    expect(unknown.explanation).toMatch(/does not recognise/i);
    expect(colourHarmony(null, parseColour('navy')).score).toBeNull();
    expect(colourHarmony(null, null).score).toBeNull();
  });

  it('gives every pairing it can compare a real score', () => {
    for (const a of COLOUR_TABLE) {
      for (const b of COLOUR_TABLE) {
        const harmony = colourHarmony(parseColour(a.key), parseColour(b.key));
        expect(harmony.kind, `${a.key}/${b.key}`).not.toBe('unknown');
        expect(typeof harmony.score, `${a.key}/${b.key}`).toBe('number');
      }
    }
  });

  it('is symmetric', () => {
    for (const a of COLOUR_TABLE) {
      for (const b of COLOUR_TABLE) {
        expect(hs(a.key, b.key)).toBeCloseTo(hs(b.key, a.key), 10);
      }
    }
  });
});

/* -------------------------------------------------------------------- slots */

describe('category to slot mapping', () => {
  it('maps every category offered in the picker', () => {
    for (const group of CATEGORY_OPTIONS) {
      for (const category of group.categories) {
        expect(slotForCategory(category), category).toBe(group.slot);
      }
    }
  });

  it('handles messy spelling and returns null for the unknown', () => {
    expect(slotForCategory('T-Shirt')).toBe('top');
    expect(slotForCategory('favourite jeans')).toBe('bottom');
    expect(slotForCategory('spacesuit')).toBeNull();
  });
});

describe('tag checkboxes for an edit form', () => {
  it('offers every tag already on the record, ticked, even one it does not list', () => {
    // The data-loss case: an edit form that declares its checkbox group present
    // clears whatever it did not render, so a stored tag outside the offered
    // list has to come back as a ticked box or editing anything erases it.
    expect(tagCheckboxes(['casual', 'work'], ['work', 'brunch'])).toEqual([
      { tag: 'casual', checked: false },
      { tag: 'work', checked: true },
      { tag: 'brunch', checked: true },
    ]);
    expect(tagCheckboxes(['summer', 'winter'], ['monsoon'])).toEqual([
      { tag: 'summer', checked: false },
      { tag: 'winter', checked: false },
      { tag: 'monsoon', checked: true },
    ]);
  });

  it('adds nothing and duplicates nothing when every stored tag is offered', () => {
    expect(tagCheckboxes(['casual', 'work'], [])).toEqual([
      { tag: 'casual', checked: false },
      { tag: 'work', checked: false },
    ]);
    expect(tagCheckboxes(['casual', 'work'], ['casual', 'work'])).toEqual([
      { tag: 'casual', checked: true },
      { tag: 'work', checked: true },
    ]);
    expect(tagCheckboxes(['casual'], ['brunch', 'brunch'])).toEqual([
      { tag: 'casual', checked: false },
      { tag: 'brunch', checked: true },
    ]);
  });

  it('keeps the offered order, so the extra tags are the tail', () => {
    expect(tagCheckboxes(['a', 'b', 'c'], ['c', 'z']).map((box) => box.tag)).toEqual([
      'a',
      'b',
      'c',
      'z',
    ]);
  });
});

describe('occasion and weather normalisation', () => {
  it('maps synonyms onto the four occasions', () => {
    expect(normaliseOccasion('office')).toBe('work');
    expect(normaliseOccasion('wedding')).toBe('formal');
    expect(normaliseOccasion('gym')).toBe('active');
    expect(normaliseOccasion('everyday')).toBe('casual');
    expect(normaliseOccasion('nonsense')).toBe('casual');
  });

  it('falls back to mild for an unknown weather band', () => {
    expect(normaliseWeather('HOT')).toBe('hot');
    expect(normaliseWeather('monsoon')).toBe('mild');
  });
});

/* -------------------------------------------------------------- suggestions */

describe('suggestOutfits', () => {
  it('fills the required slots and gives every suggestion an explanation', () => {
    const out = suggestOutfits(wardrobe, ctx());
    expect(out.length).toBeGreaterThan(0);
    for (const suggestion of out) {
      const slots = suggestion.picks.map((p) => p.slot);
      expect(slots).toContain('footwear');
      expect(slots.includes('one_piece') || (slots.includes('top') && slots.includes('bottom'))).toBe(
        true,
      );
      expect(suggestion.explanation.length).toBeGreaterThan(0);
      for (const line of suggestion.explanation) expect(line.trim().length).toBeGreaterThan(0);
      expect(suggestion.summary.length).toBeGreaterThan(0);
      expect(suggestion.itemIds.length).toBe(new Set(suggestion.itemIds).size);
      expect(suggestion.score).toBeGreaterThan(0);
      expect(suggestion.score).toBeLessThanOrEqual(1);
    }
  });

  it('explains in words, not bare numbers', () => {
    for (const suggestion of suggestOutfits(wardrobe, ctx())) {
      // At least one line must name a colour relationship in prose.
      expect(
        suggestion.explanation.some((line) =>
          /neutral|colour wheel|tones of|opposite|neighbours|clash|does not recognise/i.test(line),
        ),
        suggestion.explanation.join(' | '),
      ).toBe(true);
      // Every line is a sentence, not a number.
      for (const line of suggestion.explanation) expect(line).toMatch(/[a-z]{4,}/i);
    }
  });

  it('is deterministic: same input, same output', () => {
    const a = suggestOutfits(wardrobe, ctx());
    const b = suggestOutfits(wardrobe, ctx());
    const c = suggestOutfits([...wardrobe].reverse(), ctx());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // Input order must not change the result either.
    expect(c.map((s) => s.key)).toEqual(a.map((s) => s.key));
  });

  it('filters by formality: formal suggestions exclude training clothes', () => {
    const formal = suggestOutfits(wardrobe, ctx({ occasion: 'formal' }));
    expect(formal.length).toBeGreaterThan(0);
    const picked = new Set(formal.flatMap((s) => s.itemIds));
    expect(picked.has('vest-black')).toBe(false);
    expect(picked.has('joggers-grey')).toBe(false);
    expect(picked.has('shorts-olive')).toBe(false);
  });

  it('filters by weather: a hot day does not reach for the wool coat', () => {
    const hot = suggestOutfits(wardrobe, ctx({ weather: 'hot' }));
    expect(hot.length).toBeGreaterThan(0);
    expect(hot.flatMap((s) => s.itemIds)).not.toContain('coat-navy');

    const cold = suggestOutfits(wardrobe, ctx({ weather: 'cold', occasion: 'work' }));
    expect(cold.length).toBeGreaterThan(0);
    // A cold day must include some layer.
    for (const suggestion of cold) {
      expect(suggestion.picks.map((p) => p.slot)).toContain('layer');
    }
  });

  it('honours exclusions and leaves out anything in the wash', () => {
    const excluded = suggestOutfits(wardrobe, ctx({ excludeItemIds: ['jeans-denim'] }));
    expect(excluded.flatMap((s) => s.itemIds)).not.toContain('jeans-denim');

    const washing = wardrobe.map((i) =>
      i.id === 'sneakers-white' ? { ...i, needsCare: true } : i,
    );
    expect(suggestOutfits(washing, ctx()).flatMap((s) => s.itemIds)).not.toContain(
      'sneakers-white',
    );
  });

  it('reports missing footwear instead of pretending to have it', () => {
    const noShoes = wardrobe.filter((i) => !['sneakers-white', 'shoes-brown', 'runners-black'].includes(i.id));
    const out = suggestOutfits(noShoes, ctx());
    expect(out.length).toBeGreaterThan(0);
    for (const suggestion of out) {
      expect(suggestion.missingSlots).toContain('footwear');
      expect(suggestion.explanation.join(' ')).toMatch(/nothing recorded for/i);
    }
  });

  it('returns nothing, rather than an invented outfit, from an empty wardrobe', () => {
    expect(suggestOutfits([], ctx())).toEqual([]);
    expect(suggestOutfits([item({ id: 'lonely-belt', category: 'belt' })], ctx())).toEqual([]);
  });

  it('respects the limit and produces unique suggestions', () => {
    const out = suggestOutfits(wardrobe, ctx({ limit: 3 }));
    expect(out.length).toBeLessThanOrEqual(3);
    expect(new Set(out.map((s) => s.key)).size).toBe(out.length);
  });

  it('works for every occasion and weather combination without throwing', () => {
    for (const occasion of OCCASIONS) {
      for (const weather of WEATHER_BANDS) {
        const out = suggestOutfits(wardrobe, ctx({ occasion, weather }));
        for (const suggestion of out) expect(suggestion.explanation.length).toBeGreaterThan(0);
      }
    }
  });

  it('says when it skipped a colour it could not read', () => {
    const odd = wardrobe.map((i) => (i.id === 'jeans-denim' ? { ...i, colours: ['zorblax'] } : i));
    const out = suggestOutfits(odd, ctx());
    const mentioning = out.filter((s) => s.itemIds.includes('jeans-denim'));
    for (const suggestion of mentioning) {
      expect(suggestion.explanation.join(' ')).toMatch(/not in the GymOS colour table/i);
    }
  });
});

describe('colour that cannot be compared is reported as unscored, never as a number', () => {
  const plain = (over: Partial<OutfitItem> & { id: string }) =>
    item({ formality: 2, warmth: 2, ...over });

  it('leaves colourScore null when no pairing in the combination can be compared', () => {
    const out = suggestOutfits(
      [
        plain({ id: 'top', name: 'Mystery top', category: 't shirt', colours: ['zorblax'] }),
        plain({ id: 'bottom', name: 'Mystery jeans', category: 'jeans', colours: ['glomph'] }),
      ],
      ctx(),
    );
    expect(out).toHaveLength(1);
    const only = out[0]!;
    expect(only.colourScore).toBeNull();
    expect(only.colourScoreNote).toMatch(/not scored/i);
    expect(only.explanation.join(' ')).toMatch(/not in the GymOS colour table/i);
    // Formality fits casual exactly (1.0) and warmth 2 against mild scores 0.75,
    // so renormalising the two measured weights gives (0.35 + 0.25 * 0.75) / 0.6.
    // Folding in a stand-in 0.5 for colour would give 0.74 instead, so this
    // number is what catches a fabricated colour term coming back.
    expect(only.score).toBeCloseTo(0.9, 2);
  });

  it('leaves colourScore null for a single-garment combination, which has no pairing', () => {
    const out = suggestOutfits(
      [plain({ id: 'dress', name: 'Navy dress', category: 'dress', colours: ['navy'] })],
      ctx(),
    );
    expect(out).toHaveLength(1);
    const only = out[0]!;
    expect(only.itemIds).toEqual(['dress']);
    expect(only.colourScore).toBeNull();
    expect(only.colourScoreNote).toMatch(/single garment/i);
    expect(only.missingSlots).toContain('footwear');
    expect(only.score).toBeCloseTo(0.9, 2);
  });

  it('averages only the pairings it could compare, and says how many that was', () => {
    const out = suggestOutfits(
      [
        plain({ id: 'tee', name: 'White tee', category: 't shirt', colours: ['white'] }),
        plain({ id: 'jeans', name: 'Denim jeans', category: 'jeans', colours: ['denim'] }),
        plain({ id: 'shoes', name: 'Mystery shoes', category: 'shoes', colours: ['zorblax'] }),
      ],
      ctx(),
    );
    expect(out).toHaveLength(1);
    const only = out[0]!;
    expect(only.itemIds.sort()).toEqual(['jeans', 'shoes', 'tee']);
    // White with denim is the one comparable pair of the three, and it is a
    // neutral pairing at 0.9. Averaging the two unscorable pairs in at 0.5 each
    // would give 0.63.
    expect(only.colourScore).toBe(0.9);
    expect(only.colourScoreNote).toBeNull();
    expect(only.explanation.join(' ')).toMatch(/1 of 3 pairings/);
  });

  it('keeps a full colour score when every pairing is comparable', () => {
    for (const suggestion of suggestOutfits(wardrobe, ctx())) {
      expect(suggestion.colourScore).not.toBeNull();
      expect(suggestion.colourScoreNote).toBeNull();
      expect(suggestion.explanation.join(' ')).not.toMatch(/not scored/i);
    }
  });

  /** The engine's own rule for an item's dominant colour, restated here. */
  const dominant = (candidate: OutfitItem) => {
    for (const raw of candidate.colours) {
      const parsed = parseColour(raw);
      if (parsed) return parsed;
    }
    return null;
  };

  /**
   * What the colour aggregate has to be, derived from colourHarmony alone: the
   * mean over the pairings that carry a score, with the ones that do not
   * contributing neither a value nor a denominator. Deliberately independent of
   * the engine's own aggregation, so a filler on either side shows up as a
   * disagreement rather than as a mistake both sides share.
   */
  const expectedColour = (items: OutfitItem[]) => {
    let sum = 0;
    let scored = 0;
    let total = 0;
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        total += 1;
        const { score } = colourHarmony(dominant(items[i]!), dominant(items[j]!));
        if (score === null) continue;
        sum += score;
        scored += 1;
      }
    }
    return { colourScore: scored > 0 ? Math.round((sum / scored) * 100) / 100 : null, scored, total };
  };

  it('puts no filler value where an unreadable colour has no score', () => {
    // 1. The level the score is actually computed at. An unreadable name must
    //    produce no number against anything in the table — a filler anywhere in
    //    the pairing scorer shows up here first, with no ranking in the way.
    for (const entry of COLOUR_TABLE) {
      const pairing = colourHarmony(parseColour('zorblax'), parseColour(entry.key));
      expect(pairing.kind, entry.key).toBe('unknown');
      expect(pairing.score, entry.key).toBeNull();
    }

    // 2. The aggregate those pairings feed. One garment per slot, so the
    //    unreadable item is in the only suggestion there is however the ranking
    //    treats it. That matters: the previous version of this test swept the
    //    full wardrobe, and a 0.5 filler moved the ranking enough that no
    //    suggestion contained the unreadable item at all, leaving every
    //    iteration skipped and the whole test asserting nothing.
    const forced: OutfitItem[] = [
      plain({ id: 'tee', name: 'White tee', category: 't shirt', colours: ['white'] }),
      plain({ id: 'jeans', name: 'Mystery jeans', category: 'jeans', colours: ['zorblax'] }),
      plain({ id: 'shoes', name: 'Brown shoes', category: 'shoes', colours: ['brown'] }),
    ];
    const out = suggestOutfits(forced, ctx());
    expect(out).toHaveLength(1);
    const only = out[0]!;
    // Stated as an assertion, so a future change that stops picking the
    // unreadable item fails here instead of quietly skipping the rest.
    expect(only.itemIds.includes('jeans'), 'the unreadable item must be in the set').toBe(true);

    // White with brown is the one comparable pairing of the three, a neutral
    // pairing at 0.9. Counting the two unscorable pairings at 0.5 each would
    // report 0.63, so 0.9 is the number a filler cannot produce.
    expect(expectedColour(forced).colourScore).toBe(0.9);
    expect(only.colourScore).toBe(0.9);
    expect(only.colourPairsScored).toBe(1);
    expect(only.colourPairsTotal).toBe(3);
    expect(only.colourScoreNote).toBeNull();

    // 3. The same claim over every context, with the aggregate predicted from
    //    colourHarmony rather than read back off whichever set won.
    for (const occasion of OCCASIONS) {
      for (const weather of WEATHER_BANDS) {
        for (const suggestion of suggestOutfits(forced, ctx({ occasion, weather, limit: 6 }))) {
          const picked = suggestion.itemIds.map(
            (id) => forced.find((candidate) => candidate.id === id)!,
          );
          const expected = expectedColour(picked);
          expect(suggestion.colourScore, `${occasion}/${weather} ${suggestion.key}`).toBe(
            expected.colourScore,
          );
          expect(suggestion.colourPairsScored, `${occasion}/${weather} ${suggestion.key}`).toBe(
            expected.scored,
          );
          expect(suggestion.colourPairsTotal, `${occasion}/${weather} ${suggestion.key}`).toBe(
            expected.total,
          );
        }
      }
    }
  });

  it('reports how much of the set the colour score covers', () => {
    // The count is what a caller needs to state the limit of the number it
    // quotes, so it is part of the output, not only of the prose.
    const partial = suggestOutfits(
      [
        plain({ id: 'tee', name: 'White tee', category: 't shirt', colours: ['white'] }),
        plain({ id: 'jeans', name: 'Denim jeans', category: 'jeans', colours: ['denim'] }),
        plain({ id: 'shoes', name: 'Mystery shoes', category: 'shoes', colours: ['zorblax'] }),
      ],
      ctx(),
    )[0]!;
    expect(partial.colourPairsScored).toBe(1);
    expect(partial.colourPairsTotal).toBe(3);

    const whole = suggestOutfits(
      [
        plain({ id: 'tee', name: 'White tee', category: 't shirt', colours: ['white'] }),
        plain({ id: 'jeans', name: 'Denim jeans', category: 'jeans', colours: ['denim'] }),
        plain({ id: 'shoes', name: 'Brown shoes', category: 'shoes', colours: ['brown'] }),
      ],
      ctx(),
    )[0]!;
    expect(whole.colourPairsScored).toBe(3);
    expect(whole.colourPairsTotal).toBe(3);

    const none = suggestOutfits(
      [
        plain({ id: 'dress', name: 'Navy dress', category: 'dress', colours: ['navy'] }),
      ],
      ctx(),
    )[0]!;
    expect(none.colourPairsScored).toBe(0);
    expect(none.colourPairsTotal).toBe(0);
  });
});

/* --------------------------------------------------------------------- gaps */

describe('outfitGaps', () => {
  it('names a missing slot as a fact about the list', () => {
    const noShoes = wardrobe.filter((i) => !['sneakers-white', 'shoes-brown', 'runners-black'].includes(i.id));
    const gaps = outfitGaps(noShoes);
    const footwear = gaps.find((g) => g.slot === 'footwear');
    expect(footwear).toBeDefined();
    expect(footwear!.message).toMatch(/no footwear is recorded/i);
  });

  it('reports formality and weather bands the wardrobe cannot cover', () => {
    const casualOnly = [
      item({ id: 'tee', name: 'Tee', category: 't shirt', colours: ['white'], formality: 2, warmth: 1 }),
      item({ id: 'jeans', name: 'Jeans', category: 'jeans', colours: ['denim'], formality: 2, warmth: 2 }),
      item({ id: 'sneakers', name: 'Sneakers', category: 'sneakers', colours: ['white'], formality: 2, warmth: 2 }),
    ];
    const gaps = outfitGaps(casualOnly);
    expect(gaps.some((g) => g.kind === 'formality_gap' && g.occasion === 'formal')).toBe(true);
    expect(gaps.some((g) => g.kind === 'weather_gap' && g.weather === 'cold')).toBe(true);
  });

  it('reports unreadable colours and unmappable categories', () => {
    const gaps = outfitGaps([
      item({ id: 'a', name: 'Mystery shirt', category: 'shirt', colours: ['zorblax'] }),
      item({ id: 'b', name: 'Spacesuit', category: 'spacesuit', colours: ['white'] }),
    ]);
    expect(gaps.some((g) => g.kind === 'unreadable_colour')).toBe(true);
    expect(gaps.some((g) => g.message.includes('Spacesuit'))).toBe(true);
  });

  it('finds no gaps in a wardrobe that covers everything', () => {
    const gaps = outfitGaps(wardrobe);
    // The name promises no gaps, so assert no gaps: a spurious missing_slot,
    // formality_gap or weather_gap has to fail this too, not just an
    // unreadable_colour. The message list is included so a failure names the gap.
    expect(gaps.map((g) => g.message)).toEqual([]);
    expect(gaps).toEqual([]);
  });

  it('names every kind of gap it knows about, so the covered case means something', () => {
    // The fixture above covers everything; these are the same checks pointed at
    // wardrobes that do not, which is what makes the empty result above a claim.
    const kinds = (items: OutfitItem[]) => new Set(outfitGaps(items).map((g) => g.kind));
    expect(kinds([])).toContain('missing_slot');
    expect(kinds(wardrobe.filter((i) => i.formality <= 2))).toContain('formality_gap');
    expect(kinds(wardrobe.filter((i) => i.warmth <= 2))).toContain('weather_gap');
    expect(
      kinds(wardrobe.map((i) => (i.id === 'tee-white' ? { ...i, colours: ['zorblax'] } : i))),
    ).toContain('unreadable_colour');
  });
});

/* ------------------------------------------------------------------- safety */

/**
 * Appearance judgement must never appear in any output field. This list is the
 * vocabulary of body/appearance rating, "flattering" styling advice and
 * looksmaxxing-style scoring that Style OS refuses to implement.
 */
const BANNED = [
  'flatter', 'flattering', 'slim', 'slimming', 'slimmer', 'hide', 'hides', 'hiding',
  'conceal', 'conceals', 'concealing', 'body shape', 'body type', 'body fat', 'physique',
  'figure', 'silhouette', 'attractive', 'attractiveness', 'beauty', 'beautiful', 'handsome',
  'pretty', 'ugly', 'thin', 'skinny', 'fat', 'chubby', 'curvy', 'curves', 'bulky',
  'looksmax', 'looksmaxxing', 'glow up', 'rating', 'rate you', 'score you', 'ideal body',
  'proportions', 'face shape', 'skin tone', 'complexion', 'flaw', 'flaws',
];

function assertNoAppearanceJudgement(text: string, where: string): void {
  for (const word of BANNED) {
    const pattern = new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b`, 'i');
    expect(pattern.test(text), `${where} contains banned term "${word}": ${text}`).toBe(false);
  }
}

describe('SAFETY — Style OS never judges a body or an appearance', () => {
  it('produces no appearance judgement in any suggestion field', () => {
    for (const occasion of OCCASIONS) {
      for (const weather of WEATHER_BANDS) {
        for (const suggestion of suggestOutfits(wardrobe, ctx({ occasion, weather, limit: 6 }))) {
          assertNoAppearanceJudgement(suggestion.summary, 'summary');
          for (const line of suggestion.explanation) assertNoAppearanceJudgement(line, 'explanation');
          // No output field may be an appearance or body score.
          expect(Object.keys(suggestion).sort()).toEqual(
            [
              'colourPairsScored',
              'colourPairsTotal',
              'colourScore',
              'colourScoreNote',
              'explanation',
              'formalityScore',
              'itemIds',
              'key',
              'missingSlots',
              'picks',
              'score',
              'summary',
              'weatherScore',
            ].sort(),
          );
        }
      }
    }
  });

  it('produces no appearance judgement in any gap message', () => {
    const variants: OutfitItem[][] = [
      wardrobe,
      [],
      wardrobe.filter((i) => i.formality <= 2),
      [item({ id: 'x', name: 'Mystery', category: 'spacesuit', colours: ['zorblax'] })],
    ];
    for (const set of variants) {
      for (const gap of outfitGaps(set)) {
        assertNoAppearanceJudgement(gap.message, 'gap');
        // A gap is a statement about the clothes, never an instruction to buy.
        expect(gap.message).not.toMatch(/you should buy|you need to buy|invest in/i);
      }
    }
  });

  it('every colour explanation in the whole table is free of appearance judgement', () => {
    for (const a of COLOUR_TABLE) {
      for (const b of COLOUR_TABLE) {
        const harmony = colourHarmony(parseColour(a.key), parseColour(b.key));
        assertNoAppearanceJudgement(harmony.explanation, `${a.key}/${b.key}`);
      }
    }
  });
});
