import { RECIPE_BY_ID, type RecipeSeed } from '@/lib/content/recipes';
import { INGREDIENT_BY_ID, INGREDIENT_CATEGORY_LABELS } from '@/lib/content/nutrition-base';

export interface MealForGrocery {
  recipeId: string;
  servings: number;
  /** Optional ingredients the planner decided to leave out for this user. */
  omitIngredientIds?: string[];
}

export interface PantryEntry {
  ingredientId: string;
  quantity: number;
  unit: string;
}

export interface GroceryLine {
  ingredientId: string;
  name: string;
  category: string;
  categoryLabel: string;
  quantity: number;
  unit: string;
  /** How much of the requirement the pantry already covers. */
  pantryCovered: number;
  fromRecipeIds: string[];
  optional: boolean;
  estimatedPaise: number | null;
  notes: string[];
}

export interface GroceryResult {
  lines: GroceryLine[];
  /** Lines fully covered by the pantry, listed separately rather than silently dropped. */
  alreadyHave: GroceryLine[];
  skipped: { ingredientId: string; name: string; reason: string }[];
  totalEstimatedPaise: number | null;
  pricedLineCount: number;
  warnings: string[];
}

/** Units that can be summed together. Anything else is listed as its own line. */
const SCALABLE_UNITS = new Set(['g', 'ml', 'piece', 'tsp', 'tbsp', 'slice', 'cup']);

/**
 * Builds a consolidated grocery list from a set of planned meals.
 *
 * Rules that matter:
 *  - quantities scale by servings / recipe.servings,
 *  - only identical units are summed; mismatched units stay on separate lines,
 *  - pantry stock is subtracted, and anything fully covered is reported rather than hidden,
 *  - ingredients the planner omitted for diet or dislike reasons are skipped and listed,
 *  - cost totals use ONLY prices the user has recorded. Nothing is estimated from thin air.
 */
export function buildGroceryList(
  meals: MealForGrocery[],
  opts: {
    pantry?: PantryEntry[];
    /** Prices recorded by the user: ingredientId -> { paise, unit, perQuantity }. */
    userPrices?: Record<string, { paise: number; unit: string; perQuantity: number }>;
    includeOptional?: boolean;
    catalog?: Map<string, RecipeSeed>;
  } = {},
): GroceryResult {
  const catalog = opts.catalog ?? RECIPE_BY_ID;
  const includeOptional = opts.includeOptional ?? false;
  const warnings: string[] = [];
  const skipped: GroceryResult['skipped'] = [];

  // key: ingredientId + unit
  const acc = new Map<
    string,
    { ingredientId: string; unit: string; quantity: number; recipes: Set<string>; optional: boolean }
  >();

  for (const meal of meals) {
    const recipe = catalog.get(meal.recipeId);
    if (!recipe) {
      warnings.push(`Planned meal references unknown recipe "${meal.recipeId}" and was skipped.`);
      continue;
    }
    const omit = new Set(meal.omitIngredientIds ?? []);
    const factor = meal.servings / Math.max(1, recipe.servings);
    for (const ri of recipe.ing) {
      if (omit.has(ri.id)) {
        skipped.push({
          ingredientId: ri.id,
          name: INGREDIENT_BY_ID.get(ri.id)?.name ?? ri.id,
          reason: `left out of ${recipe.name} to match your preferences`,
        });
        continue;
      }
      if (ri.optional && !includeOptional) {
        skipped.push({
          ingredientId: ri.id,
          name: INGREDIENT_BY_ID.get(ri.id)?.name ?? ri.id,
          reason: `optional in ${recipe.name}`,
        });
        continue;
      }
      if (!SCALABLE_UNITS.has(ri.unit)) {
        warnings.push(`Unit "${ri.unit}" for ${ri.id} is not summable and was listed as-is.`);
      }
      const key = `${ri.id}::${ri.unit}`;
      const existing = acc.get(key);
      const amount = round2(ri.qty * factor);
      if (existing) {
        existing.quantity = round2(existing.quantity + amount);
        existing.recipes.add(recipe.id);
        existing.optional = existing.optional && Boolean(ri.optional);
      } else {
        acc.set(key, {
          ingredientId: ri.id,
          unit: ri.unit,
          quantity: amount,
          recipes: new Set([recipe.id]),
          optional: Boolean(ri.optional),
        });
      }
    }
  }

  // Pantry subtraction, unit-matched only.
  const pantryByKey = new Map<string, number>();
  for (const entry of opts.pantry ?? []) {
    const key = `${entry.ingredientId}::${entry.unit}`;
    pantryByKey.set(key, (pantryByKey.get(key) ?? 0) + entry.quantity);
  }

  const lines: GroceryLine[] = [];
  const alreadyHave: GroceryLine[] = [];
  let totalPaise = 0;
  let pricedLineCount = 0;

  for (const [key, item] of [...acc.entries()].sort()) {
    const ing = INGREDIENT_BY_ID.get(item.ingredientId);
    const have = pantryByKey.get(key) ?? 0;
    const needed = round2(Math.max(0, item.quantity - have));
    const covered = round2(Math.min(have, item.quantity));
    const price = opts.userPrices?.[item.ingredientId];
    let estimatedPaise: number | null = null;
    if (price && price.unit === item.unit && price.perQuantity > 0 && needed > 0) {
      estimatedPaise = Math.round((needed / price.perQuantity) * price.paise);
      totalPaise += estimatedPaise;
      pricedLineCount += 1;
    }
    const notes: string[] = [];
    if (covered > 0) notes.push(`${covered}${item.unit} already in your pantry`);
    if (!price) notes.push('no price recorded');

    const line: GroceryLine = {
      ingredientId: item.ingredientId,
      name: ing?.name ?? item.ingredientId,
      category: ing?.category ?? 'other',
      categoryLabel: INGREDIENT_CATEGORY_LABELS[ing?.category ?? 'other'] ?? 'Other',
      quantity: needed,
      unit: item.unit,
      pantryCovered: covered,
      fromRecipeIds: [...item.recipes].sort(),
      optional: item.optional,
      estimatedPaise,
      notes,
    };
    if (needed === 0) alreadyHave.push(line);
    else lines.push(line);
  }

  lines.sort(
    (a, b) => a.categoryLabel.localeCompare(b.categoryLabel) || a.name.localeCompare(b.name),
  );

  if (pricedLineCount === 0) {
    warnings.push(
      'No cost estimate: GymOS ships without retail price data and you have not recorded any prices yet. Record a price when you shop and future lists will estimate.',
    );
  } else if (pricedLineCount < lines.length) {
    warnings.push(
      `Cost estimate covers ${pricedLineCount} of ${lines.length} items — the rest have no price recorded, so the total is a floor, not a full basket cost.`,
    );
  }

  return {
    lines,
    alreadyHave,
    skipped: dedupeSkipped(skipped),
    totalEstimatedPaise: pricedLineCount > 0 ? totalPaise : null,
    pricedLineCount,
    warnings,
  };
}

function dedupeSkipped(list: GroceryResult['skipped']): GroceryResult['skipped'] {
  const seen = new Set<string>();
  const out: GroceryResult['skipped'] = [];
  for (const s of list) {
    const key = `${s.ingredientId}|${s.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Recipes you can make from what is already in the pantry. */
export function recipesFromPantry(
  pantry: PantryEntry[],
  recipes: RecipeSeed[],
  opts: { minCoverage?: number } = {},
): { recipe: RecipeSeed; coverage: number; missing: string[] }[] {
  const minCoverage = opts.minCoverage ?? 0.6;
  const have = new Map<string, number>();
  for (const p of pantry) {
    have.set(`${p.ingredientId}::${p.unit}`, (have.get(`${p.ingredientId}::${p.unit}`) ?? 0) + p.quantity);
  }
  const out: { recipe: RecipeSeed; coverage: number; missing: string[] }[] = [];
  for (const recipe of recipes) {
    const required = recipe.ing.filter((ri) => !ri.optional);
    if (required.length === 0) continue;
    const missing: string[] = [];
    let covered = 0;
    for (const ri of required) {
      const stocked = have.get(`${ri.id}::${ri.unit}`) ?? 0;
      if (stocked >= ri.qty) covered += 1;
      else missing.push(INGREDIENT_BY_ID.get(ri.id)?.name ?? ri.id);
    }
    const coverage = covered / required.length;
    if (coverage >= minCoverage) out.push({ recipe, coverage, missing });
  }
  return out.sort((a, b) => b.coverage - a.coverage || a.recipe.name.localeCompare(b.recipe.name));
}

export function formatPaise(paise: number | null): string {
  if (paise == null) return '—';
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
