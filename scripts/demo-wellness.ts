/**
 * Wellness sample data for the demo account.
 *
 * Written with direct inserts rather than through the service layer, for the same
 * reason `seed-content.ts` is: a seed should depend on the schema, which is stable, not
 * on seven service signatures. The validation those services perform is their job at
 * runtime; here the rows are authored correct.
 *
 * Nothing here touches media. The demo account has both media consents OFF, which is
 * the honest default, and a seeded photograph would be a fake photograph.
 */
import { db } from '../lib/db/client';
import {
  groomingRoutines,
  groomingRoutineSteps,
  groomingRoutineLogs,
  skincareProducts,
  skincareJournal,
  patchTests,
  groomingAppointments,
  wardrobeItems,
  outfitCombinations,
  outfitPlans,
  communicationGoals,
  voicePracticeSessions,
  communicationFeedback,
  hygieneRoutines,
  hygieneTasks,
  hygieneCheckins,
  personalCareSupplies,
  personalJournalEntries,
  checkinSchedules,
  reviewPreferences,
} from '../lib/db/schema';
import { newId } from '../lib/auth/ids';

function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function at(iso: string, hour = 9): string {
  return `${iso}T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

export function seedWellness(userId: string, today: string): void {
  /* ------------------------------------------------------------- grooming */
  const eveningRoutineId = newId();
  db.insert(groomingRoutines)
    .values({
      id: eveningRoutineId,
      userId,
      name: 'Evening wind-down',
      slot: 'evening',
      daysOfWeek: [],
      notes: 'Sample routine. Edit or delete it.',
    })
    .run();

  const morningRoutineId = newId();
  db.insert(groomingRoutines)
    .values({
      id: morningRoutineId,
      userId,
      name: 'Before work',
      slot: 'morning',
      daysOfWeek: [1, 2, 3, 4, 5],
      notes: 'Weekdays only.',
    })
    .run();

  const cleanserId = newId();
  const moisturiserId = newId();
  const sunscreenId = newId();
  const serumId = newId();

  db.insert(skincareProducts)
    .values([
      {
        id: cleanserId,
        userId,
        name: 'Gentle gel cleanser',
        brand: 'Sample Brand',
        category: 'cleanser',
        keyIngredients: ['glycerin', 'niacinamide'],
        openedAt: at(addDays(today, -40)),
        paoMonths: 12,
        pricePaise: 45_000,
        notes: 'Sample product.',
      },
      {
        id: moisturiserId,
        userId,
        name: 'Daily moisturiser',
        brand: 'Sample Brand',
        category: 'moisturiser',
        keyIngredients: ['ceramides', 'glycerin'],
        openedAt: at(addDays(today, -90)),
        paoMonths: 6,
        pricePaise: 62_000,
      },
      {
        id: sunscreenId,
        userId,
        // Deliberately already past its date, so the "products to check" surface has
        // something real to show.
        name: 'Last summer’s sunscreen',
        brand: 'Sample Brand',
        category: 'sunscreen',
        keyIngredients: ['zinc oxide'],
        openedAt: at(addDays(today, -400)),
        expiresAt: at(addDays(today, -20)),
        paoMonths: 12,
        pricePaise: 55_000,
        notes: 'Past the printed date — sample data for the expiry check.',
      },
      {
        id: serumId,
        userId,
        // Expires inside the 30-day "soon" window.
        name: 'Niacinamide serum',
        brand: 'Sample Brand',
        category: 'serum',
        keyIngredients: ['niacinamide', 'zinc'],
        openedAt: at(addDays(today, -150)),
        expiresAt: at(addDays(today, 18)),
        paoMonths: 6,
        pricePaise: 78_000,
        runningLow: true,
      },
    ])
    .run();

  db.insert(groomingRoutineSteps)
    .values([
      { id: newId(), routineId: eveningRoutineId, orderIndex: 0, label: 'Cleanse', productId: cleanserId },
      { id: newId(), routineId: eveningRoutineId, orderIndex: 1, label: 'Serum', productId: serumId },
      { id: newId(), routineId: eveningRoutineId, orderIndex: 2, label: 'Moisturise', productId: moisturiserId },
      { id: newId(), routineId: morningRoutineId, orderIndex: 0, label: 'Rinse', productId: null },
      { id: newId(), routineId: morningRoutineId, orderIndex: 1, label: 'Moisturise', productId: moisturiserId },
      { id: newId(), routineId: morningRoutineId, orderIndex: 2, label: 'Sunscreen', productId: null },
    ])
    .run();

  // A partial history, with gaps. Gaps are normal and the app does not punish them.
  const loggedDays = [1, 2, 4, 5, 8, 9, 11];
  db.insert(groomingRoutineLogs)
    .values(
      loggedDays.map((d) => ({
        id: newId(),
        userId,
        routineId: eveningRoutineId,
        date: addDays(today, -d),
        completedStepIds: [],
        note: '',
      })),
    )
    .run();

  db.insert(skincareJournal)
    .values([
      {
        id: newId(),
        userId,
        date: addDays(today, -2),
        comfort: 4,
        concerns: ['dryness'],
        productIdsUsed: [cleanserId, moisturiserId],
        note: 'Sample entry. Felt fine, a little dry on the cheeks.',
      },
      {
        id: newId(),
        userId,
        date: addDays(today, -9),
        comfort: 3,
        concerns: [],
        productIdsUsed: [cleanserId],
        note: 'Sample entry.',
      },
    ])
    .run();

  // Started yesterday, so its window is genuinely still open and the verdict is
  // "in progress" rather than a result.
  db.insert(patchTests)
    .values({
      id: newId(),
      userId,
      productId: serumId,
      startedAt: at(addDays(today, -1), 20),
      checkAt: at(today, 20),
      outcome: 'pending',
      note: 'Sample patch test, inside its observation window.',
    })
    .run();

  db.insert(groomingAppointments)
    .values({
      id: newId(),
      userId,
      title: 'Haircut',
      kind: 'haircut',
      scheduledAt: at(addDays(today, 9), 11),
      location: 'Sample salon',
      notes: 'Sample appointment.',
    })
    .run();

  /* ------------------------------------------------------------- wardrobe */
  const item = (
    name: string,
    category: string,
    colors: string[],
    formality: number,
    warmth: number,
    occasionTags: string[],
    seasonTags: string[],
    timesWorn = 0,
    lastWornDaysAgo: number | null = null,
  ) => ({
    id: newId(),
    userId,
    name,
    category,
    colors,
    fabric: '',
    sizeLabel: '',
    occasionTags,
    seasonTags,
    formality,
    warmth,
    timesWorn,
    lastWornAt: lastWornDaysAgo === null ? null : at(addDays(today, -lastWornDaysAgo)),
    notes: '',
  });

  const navyShirt = item('Navy oxford shirt', 'top', ['navy'], 4, 2, ['work', 'formal'], ['all_season'], 6, 3);
  const whiteTee = item('White t-shirt', 'top', ['white'], 2, 1, ['casual'], ['summer'], 14, 1);
  const greyKurta = item('Grey cotton kurta', 'top', ['grey'], 3, 1, ['casual', 'work'], ['summer'], 4, 12);
  const blackSweater = item('Black crew sweater', 'layer', ['black'], 3, 4, ['casual', 'work'], ['winter'], 3, 120);
  const charcoalTrousers = item('Charcoal trousers', 'bottom', ['charcoal'], 4, 2, ['work', 'formal'], ['all_season'], 8, 3);
  const jeans = item('Indigo jeans', 'bottom', ['indigo'], 2, 2, ['casual'], ['all_season'], 20, 2);
  const tanChinos = item('Tan chinos', 'bottom', ['tan'], 3, 2, ['casual', 'work'], ['summer'], 5, 20);
  const brownShoes = item('Brown derby shoes', 'footwear', ['brown'], 4, 2, ['work', 'formal'], ['all_season'], 7, 3);
  const whiteTrainers = item('White trainers', 'footwear', ['white'], 2, 1, ['casual', 'active'], ['all_season'], 25, 1);
  const runningShoes = item('Running shoes', 'footwear', ['grey', 'orange'], 1, 1, ['active'], ['all_season'], 18, 4);
  const trainingShorts = item('Training shorts', 'bottom', ['black'], 1, 1, ['active'], ['summer'], 12, 4);
  const trainingTee = item('Training tee', 'top', ['grey'], 1, 1, ['active'], ['summer'], 15, 4);
  const linenShirt = item('Linen shirt', 'top', ['beige'], 3, 1, ['casual'], ['summer'], 2, 200);
  const woolScarf = item('Wool scarf', 'accessory', ['navy'], 3, 4, ['casual', 'work'], ['winter'], 1, 300);

  const items = [
    navyShirt, whiteTee, greyKurta, blackSweater, charcoalTrousers, jeans, tanChinos,
    brownShoes, whiteTrainers, runningShoes, trainingShorts, trainingTee, linenShirt, woolScarf,
  ];
  db.insert(wardrobeItems).values(items).run();

  const workOutfitId = newId();
  const casualOutfitId = newId();
  db.insert(outfitCombinations)
    .values([
      {
        id: workOutfitId,
        userId,
        name: 'Work: navy and charcoal',
        itemIds: [navyShirt.id, charcoalTrousers.id, brownShoes.id],
        occasion: 'work',
        source: 'suggested',
        rationale: 'Navy with charcoal is a neutral pairing, and all three pieces sit at the same formality level.',
        timesWorn: 3,
        lastWornAt: at(addDays(today, -3)),
      },
      {
        id: casualOutfitId,
        userId,
        name: 'Weekend: white and indigo',
        itemIds: [whiteTee.id, jeans.id, whiteTrainers.id],
        occasion: 'casual',
        source: 'manual',
        rationale: 'White goes with anything; indigo denim keeps it casual.',
        timesWorn: 9,
        lastWornAt: at(addDays(today, -1)),
      },
    ])
    .run();

  db.insert(outfitPlans)
    .values([
      { id: newId(), userId, date: addDays(today, 1), outfitId: workOutfitId, occasion: 'work', status: 'planned', note: '' },
      { id: newId(), userId, date: addDays(today, 3), outfitId: casualOutfitId, occasion: 'casual', status: 'planned', note: '' },
      { id: newId(), userId, date: addDays(today, -1), outfitId: casualOutfitId, occasion: 'casual', status: 'worn', note: '' },
    ])
    .run();

  /* ---------------------------------------------------------------- voice */
  const goalId = newId();
  db.insert(communicationGoals)
    .values({ id: goalId, userId, label: 'Slow down when I present' })
    .run();

  // Two takes: one read against a script (so a pace figure genuinely exists) and one
  // free-speaking take with no script, where words per minute is honestly null.
  const scriptedId = newId();
  db.insert(voicePracticeSessions)
    .values({
      id: scriptedId,
      userId,
      kind: 'script_reading',
      scriptId: null,
      goalId,
      date: addDays(today, -4),
      durationSeconds: 96,
      scriptWordCount: 210,
      wordsPerMinute: 131,
      pauseCount: 11,
      longestPauseMs: 1_900,
      speakingRatio: 0.78,
      fillerTally: 4,
      selfRatedClarity: 4,
      reflection: 'Sample take. Felt steadier than last time.',
    })
    .run();

  const freeId = newId();
  db.insert(voicePracticeSessions)
    .values({
      id: freeId,
      userId,
      kind: 'free_speaking',
      scriptId: null,
      goalId,
      date: addDays(today, -1),
      durationSeconds: 64,
      // No script, so no word count and therefore no pace. GymOS does not guess one.
      scriptWordCount: null,
      wordsPerMinute: null,
      pauseCount: 9,
      longestPauseMs: 2_400,
      speakingRatio: 0.71,
      fillerTally: null,
      selfRatedClarity: 3,
      reflection: 'Sample take, speaking from notes.',
    })
    .run();

  db.insert(communicationFeedback)
    .values([
      {
        id: newId(),
        sessionId: scriptedId,
        metric: 'words_per_minute',
        value: 131,
        unit: 'wpm',
        source: 'measured',
        observation: 'From the script’s word count and the length of the take.',
      },
      {
        id: newId(),
        sessionId: scriptedId,
        metric: 'pause_count',
        value: 11,
        unit: 'count',
        source: 'measured',
        observation: 'Measured in your browser from the recorded audio.',
      },
      {
        id: newId(),
        sessionId: scriptedId,
        metric: 'filler_tally',
        value: 4,
        unit: 'count',
        source: 'self_reported',
        observation: 'You tapped this during playback.',
      },
      {
        id: newId(),
        sessionId: freeId,
        metric: 'pause_count',
        value: 9,
        unit: 'count',
        source: 'measured',
        observation: 'Measured in your browser from the recorded audio.',
      },
    ])
    .run();

  /* -------------------------------------------------------------- hygiene */
  const hygieneDailyId = newId();
  const hygieneWeeklyId = newId();
  db.insert(hygieneRoutines)
    .values([
      {
        id: hygieneDailyId,
        userId,
        name: 'Morning',
        category: 'daily',
        cadence: 'daily',
        daysOfWeek: [],
        reminderTime: '07:30',
        notes: 'Sample routine.',
      },
      {
        id: hygieneWeeklyId,
        userId,
        name: 'Deep clean',
        category: 'weekly',
        cadence: 'custom',
        daysOfWeek: [],
        everyNDays: 7,
        notes: 'Sample routine on a 7-day interval.',
      },
    ])
    .run();

  const dailyTasks = ['Brush teeth', 'Floss', 'Shower'].map((label, orderIndex) => ({
    id: newId(),
    routineId: hygieneDailyId,
    orderIndex,
    label,
    notes: '',
  }));
  const weeklyTasks = ['Change bedding', 'Clip nails'].map((label, orderIndex) => ({
    id: newId(),
    routineId: hygieneWeeklyId,
    orderIndex,
    label,
    notes: '',
  }));
  db.insert(hygieneTasks).values([...dailyTasks, ...weeklyTasks]).run();

  // Again: a partial history with gaps, because that is what a real one looks like.
  db.insert(hygieneCheckins)
    .values(
      [1, 2, 3, 5, 6, 8, 9, 10, 12].map((d) => ({
        id: newId(),
        userId,
        routineId: hygieneDailyId,
        date: addDays(today, -d),
        completedTaskIds: dailyTasks.slice(0, d % 3 === 0 ? 2 : 3).map((t) => t.id),
        snoozedUntil: null,
        note: '',
      })),
    )
    .run();

  db.insert(personalCareSupplies)
    .values([
      {
        id: newId(),
        userId,
        name: 'Toothpaste',
        category: 'dental',
        lastReplacedAt: at(addDays(today, -52)),
        replaceEveryDays: 60,
        notes: 'Sample supply.',
      },
      {
        id: newId(),
        userId,
        name: 'Razor blades',
        category: 'shaving',
        runningLow: true,
        lastReplacedAt: at(addDays(today, -35)),
        replaceEveryDays: 30,
        notes: 'Marked running low — sample data for the restock surface.',
      },
      {
        id: newId(),
        userId,
        name: 'Shampoo',
        category: 'hair',
        // No interval recorded, so GymOS says it does not know rather than estimating.
        lastReplacedAt: at(addDays(today, -20)),
        replaceEveryDays: null,
        notes: 'No interval recorded, on purpose.',
      },
    ])
    .run();

  /* -------------------------------------------------- journal and reviews */
  db.insert(personalJournalEntries)
    .values([
      {
        id: newId(),
        userId,
        date: addDays(today, -2),
        category: 'training',
        title: 'Back to it',
        body: 'Sample entry. Legs felt heavy on the first set and fine by the third.',
        tags: ['sample'],
      },
      {
        id: newId(),
        userId,
        date: addDays(today, -7),
        category: 'general',
        title: '',
        body: 'Sample entry. Slept badly, trained anyway, no harm done.',
        tags: [],
      },
    ])
    .run();

  // Check-ins stay OFF, which is the shipped default and the honest one.
  db.insert(checkinSchedules).values({ userId, cadence: 'off' }).run();

  db.insert(reviewPreferences)
    .values({ userId, cadence: 'weekly', includedSections: [] })
    .run();

  console.log(
    'wellness sample data: 2 grooming routines, 4 products, 1 open patch test, 14 wardrobe items, ' +
      '2 outfits, 2 practice takes, 2 hygiene routines, 3 supplies, 2 journal entries',
  );
}
