import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { exercises, recipes, equipmentTypes, ingredients, allergens } from '@/lib/db/schema';
import { sql, eq } from 'drizzle-orm';
import { EXERCISE_SOURCES } from '@/lib/content/exercises';
import { RECIPE_SOURCES } from '@/lib/content/recipes';
import { Badge, Card, CardHeader, Notice, PageHeader, Stat, ReviewStatusBadge } from '@/components/ui';

export const metadata: Metadata = { title: 'Content administration' };

/**
 * Internal content management view.
 *
 * It is deliberately read-mostly: publishing fitness or nutrition content as
 * "reviewed" is an operational decision that needs a named qualified reviewer and an
 * audit trail, so this build shows the review queue rather than offering a button that
 * would let anyone mark content as professionally approved.
 */
export default async function AdminContentPage() {
  await requireAdmin();

  const exerciseStatuses = db
    .select({ status: exercises.reviewStatus, c: sql<number>`count(*)` })
    .from(exercises)
    .groupBy(exercises.reviewStatus)
    .all();
  const recipeStatuses = db
    .select({ status: recipes.reviewStatus, c: sql<number>`count(*)` })
    .from(recipes)
    .groupBy(recipes.reviewStatus)
    .all();

  const totals = {
    exercises: db.select({ c: sql<number>`count(*)` }).from(exercises).all()[0]?.c ?? 0,
    recipes: db.select({ c: sql<number>`count(*)` }).from(recipes).all()[0]?.c ?? 0,
    equipment: db.select({ c: sql<number>`count(*)` }).from(equipmentTypes).all()[0]?.c ?? 0,
    ingredients: db.select({ c: sql<number>`count(*)` }).from(ingredients).all()[0]?.c ?? 0,
    allergens: db.select({ c: sql<number>`count(*)` }).from(allergens).all()[0]?.c ?? 0,
  };

  const draftExercises = db
    .select({ id: exercises.id, name: exercises.name, pattern: exercises.movementPattern })
    .from(exercises)
    .where(eq(exercises.reviewStatus, 'draft'))
    .orderBy(exercises.name)
    .limit(25)
    .all();

  const draftRecipes = db
    .select({ id: recipes.id, name: recipes.name, cuisine: recipes.cuisine })
    .from(recipes)
    .where(eq(recipes.reviewStatus, 'draft'))
    .orderBy(recipes.name)
    .limit(25)
    .all();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal"
        title="Content administration"
        description="The review state of the shared exercise and recipe libraries."
      />

      <Notice tone="warn" title="Nothing here is professionally reviewed yet">
        Every exercise and recipe in this build has review status <strong>draft</strong>. The UI
        labels them as such everywhere they appear. Marking content as reviewed requires a named
        qualified reviewer and an audit trail, which is an operational process that does not exist
        yet — so this page shows the queue rather than offering a button that would let anyone
        fabricate professional approval.
      </Notice>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
        <Stat label="Exercises" value={totals.exercises} />
        <Stat label="Recipes" value={totals.recipes} />
        <Stat label="Equipment types" value={totals.equipment} />
        <Stat label="Ingredients" value={totals.ingredients} />
        <Stat label="Allergens" value={totals.allergens} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader title="Exercise review status" />
          <div className="px-5 pb-5 space-y-1.5">
            {exerciseStatuses.map((s) => (
              <div key={s.status} className="flex items-center justify-between text-sm">
                <ReviewStatusBadge status={s.status} />
                <span className="tabular-nums">{s.c}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recipe review status" />
          <div className="px-5 pb-5 space-y-1.5">
            {recipeStatuses.map((s) => (
              <div key={s.status} className="flex items-center justify-between text-sm">
                <ReviewStatusBadge status={s.status} />
                <span className="tabular-nums">{s.c}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Content sources"
          subtitle="Every piece of content references a source record."
        />
        <div className="px-5 pb-5 space-y-3">
          {[...EXERCISE_SOURCES, ...RECIPE_SOURCES.map((r) => ({ ...r, kind: 'internal_draft' as const }))].map(
            (src) => (
              <div key={src.id} className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{src.label}</p>
                  <Badge tone="neutral">{src.kind}</Badge>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                  {src.citation}
                </p>
                {src.url ? (
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-[var(--accent)] hover:underline mt-1 inline-block"
                  >
                    {src.url}
                  </a>
                ) : null}
              </div>
            ),
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`Exercise review queue (${draftExercises.length} shown)`}
          subtitle="Awaiting review by a qualified professional."
        />
        <div className="px-5 pb-5 space-y-1">
          {draftExercises.map((ex) => (
            <Link
              key={ex.id}
              href={`/exercises/${ex.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--border-strong)]"
            >
              <span>{ex.name}</span>
              <span className="text-xs text-[var(--text-muted)]">
                {ex.pattern.replace(/_/g, ' ')}
              </span>
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Recipe review queue (${draftRecipes.length} shown)`} />
        <div className="px-5 pb-5 space-y-1">
          {draftRecipes.map((r) => (
            <Link
              key={r.id}
              href={`/nutrition/recipes/${r.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--border-strong)]"
            >
              <span>{r.name}</span>
              <span className="text-xs text-[var(--text-muted)]">
                {r.cuisine.replace(/_/g, ' ')}
              </span>
            </Link>
          ))}
        </div>
      </Card>

      <Notice tone="neutral" title="Gym partner inventories">
        The schema supports venue-submitted equipment inventories with their own review status, so
        a user submission can never appear as verified. No venue records exist in this build and no
        partner portal is implemented.
      </Notice>
    </div>
  );
}
