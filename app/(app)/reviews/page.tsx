import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/session';
import {
  previewReview,
  listReviews,
  getReview,
  getReviewPreferences,
} from '@/lib/services/review';
import type { ReviewPeriodKind } from '@/lib/engines/review';
import {
  Badge,
  BulletList,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  Notice,
  PageHeader,
  Section,
} from '@/components/ui';
import {
  GenerateReviewForm,
  ReviewSettingsCard,
  ReviewGoalsForm,
  DeleteReviewForm,
} from '@/components/review-views';

export const metadata: Metadata = { title: 'Personal review' };

function formatRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default async function ReviewsPage() {
  const user = await requireUser();
  const prefs = getReviewPreferences(user.id);
  const cadence = prefs.cadence as ReviewPeriodKind;
  const preview = previewReview(user.id, cadence === 'manual' ? 'weekly' : cadence);
  const saved = listReviews(user.id);
  const latest = saved[0] ? getReview(user.id, saved[0].id) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Personal review"
        description="One honest look across training, food and personal care — built only from what you recorded."
      />

      <Card>
        <CardHeader
          title={`Current ${cadence === 'manual' ? 'week' : cadence.replace('fortnightly', 'fortnight').replace('weekly', 'week').replace('monthly', 'month')}`}
          subtitle={formatRange(preview.window.start, preview.window.end)}
        />
        <div className="px-5 pb-5 space-y-5">
          <p className="text-sm">{preview.headline}</p>

          {preview.sections.map((section) => (
            <div key={section.key} className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{section.title}</h3>
                {section.emptyNote ? <Badge tone="neutral">Nothing recorded</Badge> : null}
              </div>
              {section.emptyNote ? (
                <p className="text-sm text-[var(--text-muted)]">{section.emptyNote}</p>
              ) : (
                <>
                  {section.facts.length > 0 ? <KeyValue items={section.facts} /> : null}
                  {section.observations.length > 0 ? (
                    <BulletList items={section.observations} />
                  ) : null}
                </>
              )}
            </div>
          ))}

          {preview.nextActions.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">If you want one small thing</h3>
              <BulletList items={preview.nextActions} />
            </div>
          ) : null}

          <Notice tone="neutral">
            <BulletList items={preview.limitations} />
          </Notice>

          <GenerateReviewForm cadence={cadence === 'manual' ? 'weekly' : cadence} />
        </div>
      </Card>

      <ReviewSettingsCard
        cadence={prefs.cadence}
        includedSections={prefs.includedSections as string[]}
      />

      <Section title="Kept reviews" description="Generating the same period again replaces its copy.">
        {saved.length === 0 ? (
          <EmptyState
            title="No reviews kept yet"
            description="Generate the current one above and it will be saved here so you can look back."
          />
        ) : (
          <div className="space-y-3">
            {saved.map((row, index) => (
              <Card key={row.id}>
                <CardHeader
                  title={formatRange(row.periodStart, row.periodEnd)}
                  subtitle={`${row.periodKind} · generated with ${row.generatorVersion}`}
                  action={<DeleteReviewForm id={row.id} />}
                />
                {index === 0 && latest ? (
                  <div className="px-5 pb-5 space-y-4">
                    <p className="text-sm">{latest.headline}</p>
                    <ReviewGoalsForm id={row.id} goals={row.userGoals} />
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
