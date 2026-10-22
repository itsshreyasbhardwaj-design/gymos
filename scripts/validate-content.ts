import { validateExerciseCatalog, EXERCISE_CATALOG } from '../lib/content/exercises';
import { validateRecipeCatalog, RECIPE_CATALOG } from '../lib/content/recipes';

const exIssues = validateExerciseCatalog();
const recipeIssues = validateRecipeCatalog();
console.log(`exercises: ${EXERCISE_CATALOG.length}, issues: ${exIssues.length}`);
for (const i of exIssues.slice(0, 40)) console.log(`  [${i.kind}] ${i.id}: ${i.detail}`);
console.log(`recipes: ${RECIPE_CATALOG.length}, issues: ${recipeIssues.length}`);
for (const i of recipeIssues.slice(0, 40)) console.log(`  [${i.kind}] ${i.id}: ${i.detail}`);
if (exIssues.length || recipeIssues.length) process.exit(1);
