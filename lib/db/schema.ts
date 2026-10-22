/**
 * GymOS relational schema (SQLite via Drizzle).
 *
 * Conventions
 *  - ids are text (uuid/slug) for stable cross-table references and easy export.
 *  - timestamps are stored as ISO-8601 UTC strings (sortable, portable to Postgres).
 *  - money is stored as integer paise (`*_paise`). Never floats for financial amounts.
 *  - loads/weights are stored as integer grams (`weight_grams`).
 *  - json-ish columns use `text({ mode: 'json' })` with explicit generics.
 */
import { sql, relations } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/* ------------------------------------------------------------------ accounts */

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailNormalized: text('email_normalized').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['user', 'admin'] })
      .notNull()
      .default('user'),
    status: text('status', { enum: ['active', 'suspended', 'deleted'] })
      .notNull()
      .default('active'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
    deletedAt: text('deleted_at'),
  },
  (t) => [uniqueIndex('users_email_norm_uq').on(t.emailNormalized)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: text('created_at').notNull().default(now),
    lastSeenAt: text('last_seen_at').notNull().default(now),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

/** Rate-limiting ledger for auth endpoints (per identifier + action). */
export const authAttempts = sqliteTable(
  'auth_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    bucket: text('bucket').notNull(), // e.g. "login:ip:<hash>" / "login:email:<norm>"
    outcome: text('outcome', { enum: ['success', 'failure'] }).notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('auth_attempts_bucket_idx').on(t.bucket, t.createdAt)],
);

export const AGE_BANDS = ['under_13', 'teen_13_17', 'adult_18_plus'] as const;
export const EXPERIENCE = ['new', 'some', 'regular', 'experienced'] as const;
export const ENVIRONMENTS = [
  'home',
  'commercial_gym',
  'apartment_gym',
  'outdoor',
  'travel',
  'custom',
] as const;

export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  ageBand: text('age_band', { enum: AGE_BANDS }).notNull(),
  language: text('language').notNull().default('en-IN'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  units: text('units', { enum: ['metric', 'imperial'] })
    .notNull()
    .default('metric'),
  experience: text('experience', { enum: EXPERIENCE }).notNull().default('new'),
  interests: text('interests', { mode: 'json' }).$type<string[]>().notNull().default([]),
  trainingDays: text('training_days', { mode: 'json' }).$type<number[]>().notNull().default([]),
  sessionMinutes: integer('session_minutes').notNull().default(45),
  preferredTime: text('preferred_time'),
  scheduleFlexibility: text('schedule_flexibility', { enum: ['rigid', 'some', 'flexible'] })
    .notNull()
    .default('some'),
  environment: text('environment', { enum: ENVIRONMENTS }).notNull().default('home'),
  activities: text('activities', { mode: 'json' }).$type<string[]>().notNull().default([]),
  limitations: text('limitations', { mode: 'json' }).$type<string[]>().notNull().default([]),
  accessibility: text('accessibility', { mode: 'json' })
    .$type<{ reduceMotion?: boolean; largeText?: boolean; highContrast?: boolean }>()
    .notNull()
    .default({}),
  onboardingStep: integer('onboarding_step').notNull().default(0),
  onboardingCompletedAt: text('onboarding_completed_at'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

/** Generic key/value preference store — also backs FitBrain memory. */
export const preferences = sqliteTable(
  'preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
    source: text('source', { enum: ['user', 'onboarding', 'fitbrain', 'system'] })
      .notNull()
      .default('user'),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const userPreferencesHistory = sqliteTable(
  'user_preferences_history',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    oldValue: text('old_value', { mode: 'json' }).$type<unknown>(),
    newValue: text('new_value', { mode: 'json' }).$type<unknown>(),
    changedAt: text('changed_at').notNull().default(now),
  },
  (t) => [index('pref_hist_user_idx').on(t.userId, t.changedAt)],
);

export const CONSENT_KINDS = [
  'terms',
  'biometrics',
  'activity_import',
  'household_planning',
  'analytics',
  'coach_sharing',
] as const;

export const consents = sqliteTable(
  'consents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: CONSENT_KINDS }).notNull(),
    version: text('version').notNull().default('1'),
    granted: integer('granted', { mode: 'boolean' }).notNull(),
    grantedAt: text('granted_at'),
    revokedAt: text('revoked_at'),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('consents_user_kind_uq').on(t.userId, t.kind)],
);

/* -------------------------------------------------------- equipment + content */

export const EQUIPMENT_CATEGORIES = [
  'bodyweight_basic',
  'free_weights',
  'resistance',
  'racks_benches',
  'upper_machines',
  'lower_machines',
  'cardio',
  'mobility_other',
] as const;

export const equipmentTypes = sqliteTable(
  'equipment_types',
  {
    id: text('id').primaryKey(), // slug
    name: text('name').notNull(),
    category: text('category', { enum: EQUIPMENT_CATEGORIES }).notNull(),
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
    description: text('description').notNull().default(''),
    /** Equipment that functionally covers this one (e.g. power_rack covers squat_rack). */
    impliesIds: text('implies_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    isCustom: integer('is_custom', { mode: 'boolean' }).notNull().default(false),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('equipment_category_idx').on(t.category)],
);

export const gymProfiles = sqliteTable(
  'gym_profiles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    environment: text('environment', { enum: ENVIRONMENTS }).notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes').notNull().default(''),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('gym_profiles_user_idx').on(t.userId)],
);

export const gymEquipment = sqliteTable(
  'gym_equipment',
  {
    id: text('id').primaryKey(),
    gymProfileId: text('gym_profile_id')
      .notNull()
      .references(() => gymProfiles.id, { onDelete: 'cascade' }),
    equipmentTypeId: text('equipment_type_id')
      .notNull()
      .references(() => equipmentTypes.id, { onDelete: 'cascade' }),
    available: integer('available', { mode: 'boolean' }).notNull().default(true),
    quantity: integer('quantity'),
    detail: text('detail', { mode: 'json' })
      .$type<{ minKg?: number; maxKg?: number; stepKg?: number; note?: string }>()
      .notNull()
      .default({}),
    preferred: integer('preferred', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes').notNull().default(''),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('gym_equipment_uq').on(t.gymProfileId, t.equipmentTypeId),
    index('gym_equipment_profile_idx').on(t.gymProfileId),
  ],
);

export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'lunge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'core_anti_extension',
  'core_anti_rotation',
  'core_flexion',
  'carry',
  'hip_isolation',
  'knee_isolation',
  'calf',
  'elbow_flexion',
  'elbow_extension',
  'shoulder_isolation',
  'rotation',
  'cardio_steady',
  'cardio_interval',
  'mobility',
  'balance',
  'plyometric',
] as const;

export const EXERCISE_CATEGORIES = [
  'compound',
  'accessory',
  'isolation',
  'cardio',
  'mobility',
  'skill',
] as const;

export const REVIEW_STATUS = ['draft', 'imported', 'reviewed', 'published'] as const;

export const exercises = sqliteTable(
  'exercises',
  {
    id: text('id').primaryKey(), // slug
    name: text('name').notNull(),
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
    movementPattern: text('movement_pattern', { enum: MOVEMENT_PATTERNS }).notNull(),
    category: text('category', { enum: EXERCISE_CATEGORIES }).notNull(),
    primaryMuscles: text('primary_muscles', { mode: 'json' }).$type<string[]>().notNull(),
    secondaryMuscles: text('secondary_muscles', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    experienceLevel: text('experience_level', { enum: ['new', 'some', 'regular', 'experienced'] })
      .notNull()
      .default('some'),
    setup: text('setup', { mode: 'json' }).$type<string[]>().notNull().default([]),
    steps: text('steps', { mode: 'json' }).$type<string[]>().notNull().default([]),
    cues: text('cues', { mode: 'json' }).$type<string[]>().notNull().default([]),
    safety: text('safety', { mode: 'json' }).$type<string[]>().notNull().default([]),
    unilateral: integer('unilateral', { mode: 'boolean' }).notNull().default(false),
    /** Logged as time rather than reps (planks, carries, cardio). */
    isTimed: integer('is_timed', { mode: 'boolean' }).notNull().default(false),
    loadable: integer('loadable', { mode: 'boolean' }).notNull().default(true),
    /** Relative time cost multiplier for session duration estimation. */
    tempoFactor: real('tempo_factor').notNull().default(1),
    /** Age suitability gate. `teen_ok=false` exercises are never auto-assigned to minors. */
    teenOk: integer('teen_ok', { mode: 'boolean' }).notNull().default(true),
    childOk: integer('child_ok', { mode: 'boolean' }).notNull().default(false),
    reviewStatus: text('review_status', { enum: REVIEW_STATUS }).notNull().default('draft'),
    sourceId: text('source_id').references(() => exerciseSources.id),
    mediaStatus: text('media_status', { enum: ['none', 'placeholder', 'licensed'] })
      .notNull()
      .default('none'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('exercises_pattern_idx').on(t.movementPattern),
    index('exercises_category_idx').on(t.category),
    index('exercises_review_idx').on(t.reviewStatus),
  ],
);

export const exerciseSources = sqliteTable('exercise_sources', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  citation: text('citation').notNull(),
  url: text('url'),
  kind: text('kind', { enum: ['guideline', 'textbook', 'organisation', 'internal_draft'] })
    .notNull()
    .default('internal_draft'),
});

export const EQUIPMENT_REQUIREMENT = ['required', 'optional'] as const;

/**
 * Equipment requirements for an exercise.
 * Rows with the same `groupKey` form an "any-of" group: the group is satisfied when the
 * user has ANY one of them. Every required group must be satisfied for eligibility.
 */
export const exerciseEquipment = sqliteTable(
  'exercise_equipment',
  {
    id: text('id').primaryKey(),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    equipmentTypeId: text('equipment_type_id')
      .notNull()
      .references(() => equipmentTypes.id, { onDelete: 'cascade' }),
    requirement: text('requirement', { enum: EQUIPMENT_REQUIREMENT }).notNull().default('required'),
    groupKey: text('group_key').notNull().default('g1'),
  },
  (t) => [
    uniqueIndex('exercise_equipment_uq').on(t.exerciseId, t.equipmentTypeId, t.groupKey),
    index('exercise_equipment_ex_idx').on(t.exerciseId),
    index('exercise_equipment_eq_idx').on(t.equipmentTypeId),
  ],
);

export const exerciseVariations = sqliteTable(
  'exercise_variations',
  {
    id: text('id').primaryKey(),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    relatedExerciseId: text('related_exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    relation: text('relation', {
      enum: ['progression', 'regression', 'variation', 'substitute'],
    }).notNull(),
  },
  (t) => [
    uniqueIndex('exercise_variations_uq').on(t.exerciseId, t.relatedExerciseId, t.relation),
    index('exercise_variations_ex_idx').on(t.exerciseId),
  ],
);

export const exerciseMedia = sqliteTable(
  'exercise_media',
  {
    id: text('id').primaryKey(),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['illustration_placeholder', 'image', 'video'] }).notNull(),
    url: text('url'),
    attribution: text('attribution'),
    license: text('license'),
    status: text('status', { enum: ['placeholder', 'pending_license', 'licensed'] })
      .notNull()
      .default('placeholder'),
  },
  (t) => [index('exercise_media_ex_idx').on(t.exerciseId)],
);

/* ------------------------------------------------------------ workout planning */

export const workoutPlans = sqliteTable(
  'workout_plans',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    generatorVersion: text('generator_version').notNull(),
    splitKind: text('split_kind').notNull(),
    inputsSnapshot: text('inputs_snapshot', { mode: 'json' }).$type<unknown>().notNull(),
    explanation: text('explanation', { mode: 'json' }).$type<string[]>().notNull().default([]),
    revisionOf: text('revision_of'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('workout_plans_user_idx').on(t.userId, t.isActive)],
);

export const workoutDays = sqliteTable(
  'workout_days',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => workoutPlans.id, { onDelete: 'cascade' }),
    dayOfWeek: integer('day_of_week').notNull(), // 0=Sun .. 6=Sat
    label: text('label').notNull(),
    focus: text('focus').notNull(),
    targetMinutes: integer('target_minutes').notNull(),
    isRest: integer('is_rest', { mode: 'boolean' }).notNull().default(false),
    orderIndex: integer('order_index').notNull().default(0),
  },
  (t) => [
    uniqueIndex('workout_days_uq').on(t.planId, t.dayOfWeek),
    index('workout_days_plan_idx').on(t.planId),
  ],
);

export const plannedExercises = sqliteTable(
  'planned_exercises',
  {
    id: text('id').primaryKey(),
    workoutDayId: text('workout_day_id')
      .notNull()
      .references(() => workoutDays.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    orderIndex: integer('order_index').notNull(),
    slotPattern: text('slot_pattern', { enum: MOVEMENT_PATTERNS }).notNull(),
    sets: integer('sets').notNull(),
    repsLow: integer('reps_low'),
    repsHigh: integer('reps_high'),
    durationSeconds: integer('duration_seconds'),
    restSeconds: integer('rest_seconds').notNull(),
    intensityNote: text('intensity_note').notNull().default(''),
    rationale: text('rationale').notNull().default(''),
    substitutedFromExerciseId: text('substituted_from_exercise_id').references(() => exercises.id),
  },
  (t) => [index('planned_exercises_day_idx').on(t.workoutDayId, t.orderIndex)],
);

export const SESSION_STATUS = [
  'scheduled',
  'in_progress',
  'completed',
  'skipped',
  'abandoned',
] as const;

export const workoutSessions = sqliteTable(
  'workout_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: text('plan_id').references(() => workoutPlans.id, { onDelete: 'set null' }),
    workoutDayId: text('workout_day_id').references(() => workoutDays.id, { onDelete: 'set null' }),
    gymProfileId: text('gym_profile_id').references(() => gymProfiles.id, { onDelete: 'set null' }),
    scheduledDate: text('scheduled_date').notNull(), // YYYY-MM-DD
    label: text('label').notNull().default(''),
    focus: text('focus').notNull().default(''),
    status: text('status', { enum: SESSION_STATUS }).notNull().default('scheduled'),
    source: text('source', { enum: ['planned', 'adhoc', 'adapted'] })
      .notNull()
      .default('planned'),
    /** Frozen copy of the exercise prescription, so later replans never rewrite history. */
    plannedSnapshot: text('planned_snapshot', { mode: 'json' }).$type<unknown>(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    durationSeconds: integer('duration_seconds'),
    notes: text('notes').notNull().default(''),
    /** Idempotency key so a resubmitted completion cannot create duplicates. */
    completionKey: text('completion_key'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('workout_sessions_user_date_idx').on(t.userId, t.scheduledDate),
    index('workout_sessions_status_idx').on(t.userId, t.status),
    uniqueIndex('workout_sessions_completion_uq').on(t.completionKey),
  ],
);

export const exerciseLogs = sqliteTable(
  'exercise_logs',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    orderIndex: integer('order_index').notNull().default(0),
    setIndex: integer('set_index').notNull(),
    reps: integer('reps'),
    weightGrams: integer('weight_grams'),
    durationSeconds: integer('duration_seconds'),
    rpe: integer('rpe'),
    skipped: integer('skipped', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes').notNull().default(''),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('exercise_logs_uq').on(t.sessionId, t.exerciseId, t.setIndex),
    index('exercise_logs_session_idx').on(t.sessionId),
    index('exercise_logs_exercise_idx').on(t.exerciseId),
  ],
);

export const sessionFeedback = sqliteTable(
  'session_feedback',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    difficulty: text('difficulty', { enum: ['too_easy', 'about_right', 'hard', 'too_hard'] }),
    recovery: text('recovery', { enum: ['fresh', 'ok', 'tired', 'very_tired'] }),
    enjoyment: integer('enjoyment'),
    discomfortReported: integer('discomfort_reported', { mode: 'boolean' })
      .notNull()
      .default(false),
    discomfortNote: text('discomfort_note').notNull().default(''),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('session_feedback_uq').on(t.sessionId)],
);

export const planRevisions = sqliteTable(
  'plan_revisions',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => workoutPlans.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    trigger: text('trigger').notNull(),
    diff: text('diff', { mode: 'json' }).$type<unknown>().notNull(),
    explanation: text('explanation', { mode: 'json' }).$type<string[]>().notNull().default([]),
    status: text('status', { enum: ['proposed', 'accepted', 'rejected', 'reverted'] })
      .notNull()
      .default('proposed'),
    appliedAt: text('applied_at'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('plan_revisions_plan_idx').on(t.planId, t.createdAt)],
);

export const substitutionEvents = sqliteTable(
  'substitution_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => workoutSessions.id, { onDelete: 'set null' }),
    fromExerciseId: text('from_exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    toExerciseId: text('to_exercise_id').references(() => exercises.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('substitution_events_user_idx').on(t.userId, t.createdAt)],
);

/* ----------------------------------------------------------------- nutrition */

export const allergens = sqliteTable('allergens', {
  id: text('id').primaryKey(), // slug
  name: text('name').notNull(),
  aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
});

export const ingredients = sqliteTable(
  'ingredients',
  {
    id: text('id').primaryKey(), // slug
    name: text('name').notNull(),
    category: text('category').notNull(),
    defaultUnit: text('default_unit').notNull(),
    allergenIds: text('allergen_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    isVegetarian: integer('is_vegetarian', { mode: 'boolean' }).notNull().default(true),
    isVegan: integer('is_vegan', { mode: 'boolean' }).notNull().default(true),
    containsEgg: integer('contains_egg', { mode: 'boolean' }).notNull().default(false),
    /** Approximate retail price in paise per base unit. null = not grounded, never guessed in UI. */
    approxPricePaisePerUnit: integer('approx_price_paise_per_unit'),
    priceUnit: text('price_unit'),
    priceSource: text('price_source'),
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default([]),
  },
  (t) => [index('ingredients_category_idx').on(t.category)],
);

export const DIET_TAGS = [
  'vegetarian',
  'vegan',
  'eggetarian',
  'non_vegetarian',
  'jain_friendly',
  'gluten_free_option',
  'high_protein',
] as const;

export const recipeSources = sqliteTable('recipe_sources', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  citation: text('citation').notNull(),
  url: text('url'),
});

export const recipes = sqliteTable(
  'recipes',
  {
    id: text('id').primaryKey(), // slug
    name: text('name').notNull(),
    cuisine: text('cuisine').notNull(),
    mealTypes: text('meal_types', { mode: 'json' }).$type<string[]>().notNull(),
    dietTags: text('diet_tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** Derived from ingredients at seed/validation time; never hand-maintained. */
    allergenIds: text('allergen_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    prepMinutes: integer('prep_minutes').notNull(),
    cookMinutes: integer('cook_minutes').notNull(),
    servings: integer('servings').notNull().default(2),
    steps: text('steps', { mode: 'json' }).$type<string[]>().notNull(),
    notes: text('notes').notNull().default(''),
    /** Only populated when a cited source exists. null means "not available" in the UI. */
    nutrition: text('nutrition', { mode: 'json' })
      .$type<{ kcal?: number; proteinG?: number; carbG?: number; fatG?: number } | null>()
      .default(null),
    nutritionSourceId: text('nutrition_source_id').references(() => recipeSources.id),
    skillLevel: text('skill_level', { enum: ['beginner', 'intermediate', 'confident'] })
      .notNull()
      .default('beginner'),
    reviewStatus: text('review_status', { enum: REVIEW_STATUS }).notNull().default('draft'),
    sourceId: text('source_id').references(() => recipeSources.id),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('recipes_cuisine_idx').on(t.cuisine)],
);

export const recipeIngredients = sqliteTable(
  'recipe_ingredients',
  {
    id: text('id').primaryKey(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    ingredientId: text('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'restrict' }),
    quantity: real('quantity').notNull(),
    unit: text('unit').notNull(),
    optional: integer('optional', { mode: 'boolean' }).notNull().default(false),
    note: text('note').notNull().default(''),
  },
  (t) => [
    uniqueIndex('recipe_ingredients_uq').on(t.recipeId, t.ingredientId),
    index('recipe_ingredients_recipe_idx').on(t.recipeId),
  ],
);

export const nutritionPrefs = sqliteTable('nutrition_prefs', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  diet: text('diet', {
    enum: ['vegetarian', 'vegan', 'eggetarian', 'non_vegetarian', 'no_preference'],
  })
    .notNull()
    .default('no_preference'),
  cuisines: text('cuisines', { mode: 'json' }).$type<string[]>().notNull().default([]),
  allergenIds: text('allergen_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
  dislikedIngredientIds: text('disliked_ingredient_ids', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default([]),
  cookingSkill: text('cooking_skill', { enum: ['beginner', 'intermediate', 'confident'] })
    .notNull()
    .default('beginner'),
  maxPrepMinutes: integer('max_prep_minutes').notNull().default(45),
  weeklyBudgetPaise: integer('weekly_budget_paise'),
  householdSize: integer('household_size').notNull().default(1),
  includeSnacks: integer('include_snacks', { mode: 'boolean' }).notNull().default(false),
  medicalDietaryNote: text('medical_dietary_note').notNull().default(''),
  updatedAt: text('updated_at').notNull().default(now),
});

export const mealPlans = sqliteTable(
  'meal_plans',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekStart: text('week_start').notNull(), // YYYY-MM-DD (Monday)
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    inputsSnapshot: text('inputs_snapshot', { mode: 'json' }).$type<unknown>().notNull(),
    explanation: text('explanation', { mode: 'json' }).$type<string[]>().notNull().default([]),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('meal_plans_uq').on(t.userId, t.weekStart)],
);

export const plannedMeals = sqliteTable(
  'planned_meals',
  {
    id: text('id').primaryKey(),
    mealPlanId: text('meal_plan_id')
      .notNull()
      .references(() => mealPlans.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    slot: text('slot', { enum: ['breakfast', 'lunch', 'dinner', 'snack'] }).notNull(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'restrict' }),
    servings: integer('servings').notNull().default(1),
    status: text('status', { enum: ['planned', 'cooked', 'skipped'] })
      .notNull()
      .default('planned'),
    swappedFromRecipeId: text('swapped_from_recipe_id').references(() => recipes.id),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('planned_meals_uq').on(t.mealPlanId, t.date, t.slot),
    index('planned_meals_plan_idx').on(t.mealPlanId),
  ],
);

export const pantryItems = sqliteTable(
  'pantry_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ingredientId: text('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    quantity: real('quantity').notNull(),
    unit: text('unit').notNull(),
    addedAt: text('added_at').notNull().default(now),
    bestBefore: text('best_before'),
    notes: text('notes').notNull().default(''),
  },
  (t) => [uniqueIndex('pantry_items_uq').on(t.userId, t.ingredientId, t.unit)],
);

/**
 * Prices the USER recorded while shopping. GymOS ships with no retail price data, so
 * this is the only source of grocery cost estimates — nothing is ever invented.
 */
export const userIngredientPrices = sqliteTable(
  'user_ingredient_prices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ingredientId: text('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    pricePaise: integer('price_paise').notNull(),
    perQuantity: real('per_quantity').notNull(),
    unit: text('unit').notNull(),
    recordedAt: text('recorded_at').notNull().default(now),
  },
  (t) => [uniqueIndex('user_ingredient_prices_uq').on(t.userId, t.ingredientId, t.unit)],
);

export const groceryLists = sqliteTable(
  'grocery_lists',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mealPlanId: text('meal_plan_id').references(() => mealPlans.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    isRecurring: integer('is_recurring', { mode: 'boolean' }).notNull().default(false),
    shareToken: text('share_token'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('grocery_lists_user_idx').on(t.userId),
    uniqueIndex('grocery_lists_share_uq').on(t.shareToken),
  ],
);

export const groceryItems = sqliteTable(
  'grocery_items',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => groceryLists.id, { onDelete: 'cascade' }),
    ingredientId: text('ingredient_id').references(() => ingredients.id, { onDelete: 'set null' }),
    customName: text('custom_name'),
    quantity: real('quantity'),
    unit: text('unit'),
    category: text('category').notNull().default('other'),
    purchased: integer('purchased', { mode: 'boolean' }).notNull().default(false),
    source: text('source', { enum: ['generated', 'manual'] })
      .notNull()
      .default('generated'),
    estimatedPaise: integer('estimated_paise'),
    note: text('note').notNull().default(''),
  },
  (t) => [index('grocery_items_list_idx').on(t.listId)],
);

/* ------------------------------------------------------------------ progress */

export const activityRecords = sqliteTable(
  'activity_records',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['walk', 'cycle', 'run', 'swim', 'sport', 'other', 'imported'],
    }).notNull(),
    date: text('date').notNull(),
    minutes: integer('minutes'),
    distanceMeters: integer('distance_meters'),
    steps: integer('steps'),
    notes: text('notes').notNull().default(''),
    source: text('source', { enum: ['manual', 'import'] })
      .notNull()
      .default('manual'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('activity_records_user_date_idx').on(t.userId, t.date)],
);

export const performanceMilestones = sqliteTable(
  'performance_milestones',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['first_time', 'most_reps', 'heaviest_set', 'longest_hold', 'most_volume'],
    }).notNull(),
    reps: integer('reps'),
    weightGrams: integer('weight_grams'),
    durationSeconds: integer('duration_seconds'),
    volumeGrams: integer('volume_grams'),
    sessionId: text('session_id').references(() => workoutSessions.id, { onDelete: 'set null' }),
    achievedAt: text('achieved_at').notNull().default(now),
  },
  (t) => [
    index('milestones_user_idx').on(t.userId, t.achievedAt),
    uniqueIndex('milestones_uq').on(t.userId, t.exerciseId, t.kind, t.sessionId),
  ],
);

export const progressSnapshots = sqliteTable(
  'progress_snapshots',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekStart: text('week_start').notNull(),
    metrics: text('metrics', { mode: 'json' }).$type<Record<string, number>>().notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('progress_snapshots_uq').on(t.userId, t.weekStart)],
);

export const biometricRecords = sqliteTable(
  'biometric_records',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    kind: text('kind', {
      enum: ['steps', 'sleep_minutes', 'resting_hr', 'body_mass_grams', 'self_reported_recovery'],
    }).notNull(),
    value: real('value').notNull(),
    unit: text('unit').notNull(),
    source: text('source', { enum: ['manual', 'import_pending'] })
      .notNull()
      .default('manual'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('biometric_uq').on(t.userId, t.date, t.kind)],
);

/* ----------------------------------------------------------------- operations */

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    href: text('href'),
    readAt: text('read_at'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const PLANS = ['free', 'pro'] as const;

export const entitlements = sqliteTable(
  'entitlements',
  {
    id: text('id').primaryKey(),
    plan: text('plan', { enum: PLANS }).notNull(),
    feature: text('feature').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    limitValue: integer('limit_value'),
    note: text('note').notNull().default(''),
  },
  (t) => [uniqueIndex('entitlements_uq').on(t.plan, t.feature)],
);

export const subscriptionRecords = sqliteTable(
  'subscription_records',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    plan: text('plan', { enum: PLANS }).notNull().default('free'),
    status: text('status', {
      enum: ['active', 'trialing', 'past_due', 'cancelled', 'none', 'dev_granted'],
    })
      .notNull()
      .default('none'),
    amountPaise: integer('amount_paise').notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    interval: text('interval', { enum: ['month', 'year', 'none'] })
      .notNull()
      .default('none'),
    provider: text('provider', { enum: ['none', 'razorpay'] })
      .notNull()
      .default('none'),
    providerRef: text('provider_ref'),
    startedAt: text('started_at'),
    currentPeriodEnd: text('current_period_end'),
    cancelledAt: text('cancelled_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('subscription_user_idx').on(t.userId, t.createdAt)],
);

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target').notNull().default(''),
    meta: text('meta', { mode: 'json' }).$type<unknown>(),
    ipHash: text('ip_hash'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('audit_events_user_idx').on(t.userId, t.createdAt)],
);

export const dataExports = sqliteTable(
  'data_exports',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'ready', 'failed'] })
      .notNull()
      .default('pending'),
    payload: text('payload', { mode: 'json' }).$type<unknown>(),
    requestedAt: text('requested_at').notNull().default(now),
    completedAt: text('completed_at'),
  },
  (t) => [index('data_exports_user_idx').on(t.userId, t.requestedAt)],
);

/* --------------------------------------------------------- gym partner (arch) */

export const gymVenues = sqliteTable(
  'gym_venues',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    city: text('city').notNull().default(''),
    addressLine: text('address_line').notNull().default(''),
    /** Verification is an operational process; nothing is "verified" without a reviewer. */
    verificationStatus: text('verification_status', {
      enum: ['unclaimed', 'claimed', 'pending_review', 'verified'],
    })
      .notNull()
      .default('unclaimed'),
    verifiedByUserId: text('verified_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    verifiedAt: text('verified_at'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('gym_venues_city_idx').on(t.city)],
);

export const gymVenueEquipment = sqliteTable(
  'gym_venue_equipment',
  {
    id: text('id').primaryKey(),
    venueId: text('venue_id')
      .notNull()
      .references(() => gymVenues.id, { onDelete: 'cascade' }),
    equipmentTypeId: text('equipment_type_id')
      .notNull()
      .references(() => equipmentTypes.id, { onDelete: 'cascade' }),
    available: integer('available', { mode: 'boolean' }).notNull().default(true),
    quantity: integer('quantity'),
    submittedByUserId: text('submitted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewStatus: text('review_status', { enum: REVIEW_STATUS }).notNull().default('draft'),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('gym_venue_equipment_uq').on(t.venueId, t.equipmentTypeId)],
);

/* ----------------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, { fields: [users.id], references: [userProfiles.userId] }),
  nutritionPrefs: one(nutritionPrefs, { fields: [users.id], references: [nutritionPrefs.userId] }),
  gymProfiles: many(gymProfiles),
  plans: many(workoutPlans),
  sessions: many(workoutSessions),
}));

export const gymProfilesRelations = relations(gymProfiles, ({ one, many }) => ({
  user: one(users, { fields: [gymProfiles.userId], references: [users.id] }),
  equipment: many(gymEquipment),
}));

export const gymEquipmentRelations = relations(gymEquipment, ({ one }) => ({
  profile: one(gymProfiles, {
    fields: [gymEquipment.gymProfileId],
    references: [gymProfiles.id],
  }),
  equipmentType: one(equipmentTypes, {
    fields: [gymEquipment.equipmentTypeId],
    references: [equipmentTypes.id],
  }),
}));

export const exercisesRelations = relations(exercises, ({ many, one }) => ({
  equipment: many(exerciseEquipment),
  media: many(exerciseMedia),
  source: one(exerciseSources, { fields: [exercises.sourceId], references: [exerciseSources.id] }),
}));

export const exerciseEquipmentRelations = relations(exerciseEquipment, ({ one }) => ({
  exercise: one(exercises, {
    fields: [exerciseEquipment.exerciseId],
    references: [exercises.id],
  }),
  equipmentType: one(equipmentTypes, {
    fields: [exerciseEquipment.equipmentTypeId],
    references: [equipmentTypes.id],
  }),
}));

export const workoutPlansRelations = relations(workoutPlans, ({ many, one }) => ({
  days: many(workoutDays),
  user: one(users, { fields: [workoutPlans.userId], references: [users.id] }),
}));

export const workoutDaysRelations = relations(workoutDays, ({ many, one }) => ({
  plan: one(workoutPlans, { fields: [workoutDays.planId], references: [workoutPlans.id] }),
  exercises: many(plannedExercises),
}));

export const plannedExercisesRelations = relations(plannedExercises, ({ one }) => ({
  day: one(workoutDays, {
    fields: [plannedExercises.workoutDayId],
    references: [workoutDays.id],
  }),
  exercise: one(exercises, {
    fields: [plannedExercises.exerciseId],
    references: [exercises.id],
  }),
}));

export const workoutSessionsRelations = relations(workoutSessions, ({ many, one }) => ({
  logs: many(exerciseLogs),
  feedback: one(sessionFeedback, {
    fields: [workoutSessions.id],
    references: [sessionFeedback.sessionId],
  }),
}));

export const recipesRelations = relations(recipes, ({ many, one }) => ({
  ingredients: many(recipeIngredients),
  source: one(recipeSources, { fields: [recipes.sourceId], references: [recipeSources.id] }),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeIngredients.recipeId], references: [recipes.id] }),
  ingredient: one(ingredients, {
    fields: [recipeIngredients.ingredientId],
    references: [ingredients.id],
  }),
}));

export const mealPlansRelations = relations(mealPlans, ({ many }) => ({
  meals: many(plannedMeals),
}));

export const plannedMealsRelations = relations(plannedMeals, ({ one }) => ({
  plan: one(mealPlans, { fields: [plannedMeals.mealPlanId], references: [mealPlans.id] }),
  recipe: one(recipes, { fields: [plannedMeals.recipeId], references: [recipes.id] }),
}));

export const groceryListsRelations = relations(groceryLists, ({ many }) => ({
  items: many(groceryItems),
}));

export const groceryItemsRelations = relations(groceryItems, ({ one }) => ({
  list: one(groceryLists, { fields: [groceryItems.listId], references: [groceryLists.id] }),
  ingredient: one(ingredients, {
    fields: [groceryItems.ingredientId],
    references: [ingredients.id],
  }),
}));
