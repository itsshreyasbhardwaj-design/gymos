export interface AllergenSeed {
  id: string;
  name: string;
  aliases: string[];
}

/** Allergen taxonomy. Matching is by explicit ingredient tag, never by name guessing. */
export const ALLERGEN_CATALOG: AllergenSeed[] = [
  { id: 'milk', name: 'Milk / dairy', aliases: ['dairy', 'lactose', 'milk solids', 'casein'] },
  { id: 'egg', name: 'Egg', aliases: ['eggs', 'albumen'] },
  { id: 'peanut', name: 'Peanut', aliases: ['groundnut', 'moongphali'] },
  { id: 'tree_nut', name: 'Tree nuts', aliases: ['almond', 'cashew', 'walnut', 'pistachio', 'kaju', 'badam'] },
  { id: 'gluten', name: 'Gluten (wheat, barley, rye)', aliases: ['wheat', 'atta', 'maida', 'suji', 'rava', 'barley'] },
  { id: 'soy', name: 'Soy', aliases: ['soya', 'tofu', 'soybean'] },
  { id: 'fish', name: 'Fish', aliases: ['rohu', 'hilsa', 'pomfret', 'anchovy'] },
  { id: 'shellfish', name: 'Shellfish', aliases: ['prawn', 'shrimp', 'crab', 'chingri'] },
  { id: 'sesame', name: 'Sesame', aliases: ['til', 'tahini', 'gingelly'] },
  { id: 'mustard', name: 'Mustard', aliases: ['sarson', 'kasundi', 'rai'] },
];

export interface IngredientSeed {
  id: string;
  name: string;
  category: string;
  unit: string;
  allergens?: string[];
  /** Defaults: vegetarian + vegan. Set explicitly when not. */
  veg?: boolean;
  vegan?: boolean;
  egg?: boolean;
  aliases?: string[];
}

export const INGREDIENT_CATEGORIES = [
  'grains_flours',
  'pulses_legumes',
  'vegetables',
  'fruits',
  'dairy',
  'eggs',
  'meat_fish',
  'oils_fats',
  'spices',
  'herbs_aromatics',
  'nuts_seeds',
  'condiments',
  'sweeteners',
  'other',
] as const;

export const INGREDIENT_CATEGORY_LABELS: Record<string, string> = {
  grains_flours: 'Grains & flours',
  pulses_legumes: 'Pulses & legumes',
  vegetables: 'Vegetables',
  fruits: 'Fruit',
  dairy: 'Dairy',
  eggs: 'Eggs',
  meat_fish: 'Meat & fish',
  oils_fats: 'Oils & fats',
  spices: 'Spices',
  herbs_aromatics: 'Herbs & aromatics',
  nuts_seeds: 'Nuts & seeds',
  condiments: 'Condiments',
  sweeteners: 'Sweeteners',
  other: 'Other',
};

export const INGREDIENT_CATALOG: IngredientSeed[] = [
  // grains and flours
  { id: 'rice-basmati', name: 'Basmati rice', category: 'grains_flours', unit: 'g' },
  { id: 'rice-sona-masoori', name: 'Sona masoori rice', category: 'grains_flours', unit: 'g' },
  { id: 'rice-parboiled', name: 'Parboiled rice', category: 'grains_flours', unit: 'g', aliases: ['sela chawal'] },
  { id: 'poha', name: 'Flattened rice (poha)', category: 'grains_flours', unit: 'g', aliases: ['chire', 'aval'] },
  { id: 'atta', name: 'Whole wheat flour (atta)', category: 'grains_flours', unit: 'g', allergens: ['gluten'] },
  { id: 'maida', name: 'Refined flour (maida)', category: 'grains_flours', unit: 'g', allergens: ['gluten'] },
  { id: 'suji', name: 'Semolina (suji / rava)', category: 'grains_flours', unit: 'g', allergens: ['gluten'] },
  { id: 'besan', name: 'Gram flour (besan)', category: 'grains_flours', unit: 'g' },
  { id: 'rice-flour', name: 'Rice flour', category: 'grains_flours', unit: 'g' },
  { id: 'oats', name: 'Rolled oats', category: 'grains_flours', unit: 'g', allergens: ['gluten'] },
  { id: 'bread-whole-wheat', name: 'Whole wheat bread', category: 'grains_flours', unit: 'slice', allergens: ['gluten'] },
  { id: 'vermicelli', name: 'Vermicelli (semiya)', category: 'grains_flours', unit: 'g', allergens: ['gluten'] },
  { id: 'pasta-dry', name: 'Dried pasta', category: 'grains_flours', unit: 'g', allergens: ['gluten'] },
  { id: 'quinoa', name: 'Quinoa', category: 'grains_flours', unit: 'g' },
  { id: 'millet-ragi', name: 'Ragi (finger millet) flour', category: 'grains_flours', unit: 'g' },
  { id: 'tortilla-wheat', name: 'Wheat tortilla', category: 'grains_flours', unit: 'piece', allergens: ['gluten'] },

  // pulses and legumes
  { id: 'toor-dal', name: 'Toor dal (pigeon pea)', category: 'pulses_legumes', unit: 'g', aliases: ['arhar dal'] },
  { id: 'moong-dal', name: 'Moong dal', category: 'pulses_legumes', unit: 'g' },
  { id: 'masoor-dal', name: 'Masoor dal (red lentil)', category: 'pulses_legumes', unit: 'g' },
  { id: 'chana-dal', name: 'Chana dal', category: 'pulses_legumes', unit: 'g' },
  { id: 'urad-dal', name: 'Urad dal', category: 'pulses_legumes', unit: 'g' },
  { id: 'rajma', name: 'Rajma (kidney beans)', category: 'pulses_legumes', unit: 'g' },
  { id: 'kabuli-chana', name: 'Chickpeas (kabuli chana)', category: 'pulses_legumes', unit: 'g' },
  { id: 'kala-chana', name: 'Black chana', category: 'pulses_legumes', unit: 'g' },
  { id: 'lobia', name: 'Black-eyed peas (lobia)', category: 'pulses_legumes', unit: 'g' },
  { id: 'green-peas', name: 'Green peas', category: 'pulses_legumes', unit: 'g', aliases: ['matar'] },
  { id: 'tofu', name: 'Tofu', category: 'pulses_legumes', unit: 'g', allergens: ['soy'] },
  { id: 'soya-chunks', name: 'Soya chunks', category: 'pulses_legumes', unit: 'g', allergens: ['soy'] },

  // vegetables
  { id: 'onion', name: 'Onion', category: 'vegetables', unit: 'g' },
  { id: 'tomato', name: 'Tomato', category: 'vegetables', unit: 'g' },
  { id: 'potato', name: 'Potato', category: 'vegetables', unit: 'g', aliases: ['aloo'] },
  { id: 'cauliflower', name: 'Cauliflower', category: 'vegetables', unit: 'g', aliases: ['phool gobi'] },
  { id: 'cabbage', name: 'Cabbage', category: 'vegetables', unit: 'g' },
  { id: 'spinach', name: 'Spinach', category: 'vegetables', unit: 'g', aliases: ['palak'] },
  { id: 'brinjal', name: 'Brinjal (aubergine)', category: 'vegetables', unit: 'g', aliases: ['baingan', 'begun'] },
  { id: 'okra', name: 'Okra (bhindi)', category: 'vegetables', unit: 'g', aliases: ['dherosh'] },
  { id: 'bottle-gourd', name: 'Bottle gourd (lauki)', category: 'vegetables', unit: 'g' },
  { id: 'ridge-gourd', name: 'Ridge gourd', category: 'vegetables', unit: 'g', aliases: ['jhinge'] },
  { id: 'pumpkin', name: 'Pumpkin', category: 'vegetables', unit: 'g', aliases: ['kaddu', 'kumro'] },
  { id: 'carrot', name: 'Carrot', category: 'vegetables', unit: 'g' },
  { id: 'beans-french', name: 'French beans', category: 'vegetables', unit: 'g' },
  { id: 'capsicum', name: 'Capsicum', category: 'vegetables', unit: 'g', aliases: ['bell pepper', 'shimla mirch'] },
  { id: 'cucumber', name: 'Cucumber', category: 'vegetables', unit: 'g' },
  { id: 'drumstick', name: 'Drumstick (moringa)', category: 'vegetables', unit: 'g', aliases: ['sahjan'] },
  { id: 'radish', name: 'Radish (mooli)', category: 'vegetables', unit: 'g' },
  { id: 'beetroot', name: 'Beetroot', category: 'vegetables', unit: 'g' },
  { id: 'mushroom', name: 'Mushroom', category: 'vegetables', unit: 'g' },
  { id: 'sweet-potato', name: 'Sweet potato', category: 'vegetables', unit: 'g' },
  { id: 'broccoli', name: 'Broccoli', category: 'vegetables', unit: 'g' },
  { id: 'lettuce', name: 'Lettuce', category: 'vegetables', unit: 'g' },
  { id: 'coconut-fresh', name: 'Fresh coconut', category: 'vegetables', unit: 'g' },
  { id: 'raw-banana', name: 'Raw banana', category: 'vegetables', unit: 'g' },
  { id: 'pointed-gourd', name: 'Pointed gourd (parwal)', category: 'vegetables', unit: 'g', aliases: ['potol'] },

  // fruit
  { id: 'banana', name: 'Banana', category: 'fruits', unit: 'piece' },
  { id: 'apple', name: 'Apple', category: 'fruits', unit: 'piece' },
  { id: 'papaya', name: 'Papaya', category: 'fruits', unit: 'g' },
  { id: 'mango', name: 'Mango', category: 'fruits', unit: 'g' },
  { id: 'lemon', name: 'Lemon', category: 'fruits', unit: 'piece' },
  { id: 'orange', name: 'Orange', category: 'fruits', unit: 'piece' },
  { id: 'dates', name: 'Dates', category: 'fruits', unit: 'g' },
  { id: 'pomegranate', name: 'Pomegranate', category: 'fruits', unit: 'g' },
  { id: 'guava', name: 'Guava', category: 'fruits', unit: 'piece' },

  // dairy
  { id: 'milk', name: 'Milk', category: 'dairy', unit: 'ml', allergens: ['milk'], vegan: false },
  { id: 'curd', name: 'Curd (dahi)', category: 'dairy', unit: 'g', allergens: ['milk'], vegan: false },
  { id: 'paneer', name: 'Paneer', category: 'dairy', unit: 'g', allergens: ['milk'], vegan: false },
  { id: 'ghee', name: 'Ghee', category: 'dairy', unit: 'g', allergens: ['milk'], vegan: false },
  { id: 'butter', name: 'Butter', category: 'dairy', unit: 'g', allergens: ['milk'], vegan: false },
  { id: 'cheese', name: 'Cheese', category: 'dairy', unit: 'g', allergens: ['milk'], vegan: false },
  { id: 'cream', name: 'Fresh cream', category: 'dairy', unit: 'ml', allergens: ['milk'], vegan: false },
  { id: 'buttermilk', name: 'Buttermilk (chaas)', category: 'dairy', unit: 'ml', allergens: ['milk'], vegan: false },

  // eggs
  { id: 'egg', name: 'Egg', category: 'eggs', unit: 'piece', allergens: ['egg'], veg: false, vegan: false, egg: true },

  // meat and fish
  { id: 'chicken-breast', name: 'Chicken breast', category: 'meat_fish', unit: 'g', veg: false, vegan: false },
  { id: 'chicken-curry-cut', name: 'Chicken (curry cut, bone-in)', category: 'meat_fish', unit: 'g', veg: false, vegan: false },
  { id: 'mutton', name: 'Mutton', category: 'meat_fish', unit: 'g', veg: false, vegan: false },
  { id: 'fish-rohu', name: 'Rohu fish', category: 'meat_fish', unit: 'g', allergens: ['fish'], veg: false, vegan: false },
  { id: 'fish-pomfret', name: 'Pomfret', category: 'meat_fish', unit: 'g', allergens: ['fish'], veg: false, vegan: false },
  { id: 'fish-bhetki', name: 'Bhetki (barramundi)', category: 'meat_fish', unit: 'g', allergens: ['fish'], veg: false, vegan: false },
  { id: 'prawns', name: 'Prawns', category: 'meat_fish', unit: 'g', allergens: ['shellfish'], veg: false, vegan: false },

  // oils and fats
  { id: 'mustard-oil', name: 'Mustard oil', category: 'oils_fats', unit: 'ml', allergens: ['mustard'] },
  { id: 'sunflower-oil', name: 'Sunflower oil', category: 'oils_fats', unit: 'ml' },
  { id: 'coconut-oil', name: 'Coconut oil', category: 'oils_fats', unit: 'ml' },
  { id: 'olive-oil', name: 'Olive oil', category: 'oils_fats', unit: 'ml' },
  { id: 'sesame-oil', name: 'Sesame oil', category: 'oils_fats', unit: 'ml', allergens: ['sesame'] },

  // spices
  { id: 'turmeric', name: 'Turmeric powder', category: 'spices', unit: 'tsp' },
  { id: 'red-chilli-powder', name: 'Red chilli powder', category: 'spices', unit: 'tsp' },
  { id: 'coriander-powder', name: 'Coriander powder', category: 'spices', unit: 'tsp' },
  { id: 'cumin-powder', name: 'Cumin powder', category: 'spices', unit: 'tsp' },
  { id: 'cumin-seeds', name: 'Cumin seeds', category: 'spices', unit: 'tsp' },
  { id: 'mustard-seeds', name: 'Mustard seeds', category: 'spices', unit: 'tsp', allergens: ['mustard'] },
  { id: 'garam-masala', name: 'Garam masala', category: 'spices', unit: 'tsp' },
  { id: 'panch-phoron', name: 'Panch phoron', category: 'spices', unit: 'tsp', allergens: ['mustard'] },
  { id: 'sambar-powder', name: 'Sambar powder', category: 'spices', unit: 'tsp' },
  { id: 'rasam-powder', name: 'Rasam powder', category: 'spices', unit: 'tsp' },
  { id: 'asafoetida', name: 'Asafoetida (hing)', category: 'spices', unit: 'tsp', allergens: ['gluten'] },
  { id: 'bay-leaf', name: 'Bay leaf', category: 'spices', unit: 'piece' },
  { id: 'cinnamon', name: 'Cinnamon', category: 'spices', unit: 'piece' },
  { id: 'cardamom', name: 'Green cardamom', category: 'spices', unit: 'piece' },
  { id: 'clove', name: 'Clove', category: 'spices', unit: 'piece' },
  { id: 'black-pepper', name: 'Black pepper', category: 'spices', unit: 'tsp' },
  { id: 'fenugreek-seeds', name: 'Fenugreek seeds (methi)', category: 'spices', unit: 'tsp' },
  { id: 'kashmiri-chilli', name: 'Kashmiri chilli powder', category: 'spices', unit: 'tsp' },
  { id: 'chaat-masala', name: 'Chaat masala', category: 'spices', unit: 'tsp' },
  { id: 'salt', name: 'Salt', category: 'spices', unit: 'tsp' },
  { id: 'oregano-dried', name: 'Dried oregano', category: 'spices', unit: 'tsp' },

  // herbs and aromatics
  { id: 'ginger', name: 'Ginger', category: 'herbs_aromatics', unit: 'g' },
  { id: 'garlic', name: 'Garlic', category: 'herbs_aromatics', unit: 'g' },
  { id: 'green-chilli', name: 'Green chilli', category: 'herbs_aromatics', unit: 'piece' },
  { id: 'coriander-leaves', name: 'Coriander leaves', category: 'herbs_aromatics', unit: 'g', aliases: ['dhania'] },
  { id: 'curry-leaves', name: 'Curry leaves', category: 'herbs_aromatics', unit: 'g' },
  { id: 'mint-leaves', name: 'Mint leaves', category: 'herbs_aromatics', unit: 'g', aliases: ['pudina'] },
  { id: 'spring-onion', name: 'Spring onion', category: 'herbs_aromatics', unit: 'g' },
  { id: 'basil-fresh', name: 'Fresh basil', category: 'herbs_aromatics', unit: 'g' },

  // nuts and seeds
  { id: 'peanuts', name: 'Peanuts', category: 'nuts_seeds', unit: 'g', allergens: ['peanut'] },
  { id: 'cashews', name: 'Cashews', category: 'nuts_seeds', unit: 'g', allergens: ['tree_nut'] },
  { id: 'almonds', name: 'Almonds', category: 'nuts_seeds', unit: 'g', allergens: ['tree_nut'] },
  { id: 'walnuts', name: 'Walnuts', category: 'nuts_seeds', unit: 'g', allergens: ['tree_nut'] },
  { id: 'sesame-seeds', name: 'Sesame seeds', category: 'nuts_seeds', unit: 'g', allergens: ['sesame'] },
  { id: 'chia-seeds', name: 'Chia seeds', category: 'nuts_seeds', unit: 'g' },
  { id: 'flax-seeds', name: 'Flax seeds', category: 'nuts_seeds', unit: 'g' },
  { id: 'pumpkin-seeds', name: 'Pumpkin seeds', category: 'nuts_seeds', unit: 'g' },
  { id: 'peanut-butter', name: 'Peanut butter', category: 'nuts_seeds', unit: 'g', allergens: ['peanut'] },

  // condiments and other
  { id: 'tamarind', name: 'Tamarind', category: 'condiments', unit: 'g', aliases: ['imli'] },
  { id: 'soy-sauce', name: 'Soy sauce', category: 'condiments', unit: 'ml', allergens: ['soy', 'gluten'] },
  { id: 'tomato-ketchup', name: 'Tomato ketchup', category: 'condiments', unit: 'ml' },
  { id: 'kasundi', name: 'Kasundi (mustard sauce)', category: 'condiments', unit: 'g', allergens: ['mustard'] },
  { id: 'vinegar', name: 'Vinegar', category: 'condiments', unit: 'ml' },
  { id: 'coconut-milk', name: 'Coconut milk', category: 'condiments', unit: 'ml' },
  { id: 'tahini', name: 'Tahini', category: 'condiments', unit: 'g', allergens: ['sesame'] },
  { id: 'yeast-instant', name: 'Instant yeast', category: 'other', unit: 'tsp' },
  { id: 'baking-soda', name: 'Baking soda', category: 'other', unit: 'tsp' },
  { id: 'jaggery', name: 'Jaggery', category: 'sweeteners', unit: 'g', aliases: ['gur'] },
  { id: 'sugar', name: 'Sugar', category: 'sweeteners', unit: 'g' },
  { id: 'honey', name: 'Honey', category: 'sweeteners', unit: 'g', vegan: false },
  { id: 'water', name: 'Water', category: 'other', unit: 'ml' },
];

export const INGREDIENT_BY_ID = new Map(INGREDIENT_CATALOG.map((i) => [i.id, i]));
export const ALLERGEN_BY_ID = new Map(ALLERGEN_CATALOG.map((a) => [a.id, a]));

/**
 * Pricing note: GymOS ships with no grounded retail price data, so
 * `approx_price_paise_per_unit` is null for every seeded ingredient. Grocery cost
 * estimates come only from prices the user records themselves
 * (see `user_ingredient_prices`). The UI never shows an invented price.
 */
export const PRICE_DATA_AVAILABLE = false;
