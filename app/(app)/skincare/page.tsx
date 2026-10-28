import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import {
  productsWithExpiry,
  listJournal,
  listPatchTests,
  duplicateIngredients,
  PRODUCT_CATEGORIES,
  PATCH_TEST_WINDOW_HOURS,
  DEFAULT_PATCH_TEST_WINDOW_HOURS,
} from '@/lib/services/skincare';
import { Card, CardHeader, EmptyState, Notice, PageHeader } from '@/components/ui';
import {
  JournalEntryRow,
  JournalForm,
  PatchTestForm,
  PatchTestRow,
  ProductForm,
  ProductRow,
} from '@/components/skincare-forms';

export const metadata: Metadata = { title: 'Skincare' };

export default async function SkincarePage() {
  const user = await requireUser();
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const products = productsWithExpiry(user.id, today);
  const productOptions = products.map(({ product }) => ({ id: product.id, name: product.name }));
  const journal = listJournal(user.id, { limit: 30 });
  const todayEntry = journal.find((entry) => entry.date === today) ?? null;
  const patchTests = listPatchTests(user.id, nowIso);
  const duplicates = duplicateIngredients(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Personal care"
        title="Skincare"
        description="A shelf inventory, a written journal and patch tests. Everything on this page is something you typed in."
      />

      <Notice tone="neutral" title="What GymOS can and cannot do here">
        It can track dates, hold your notes and time a patch test. It cannot look at your skin,
        analyse a photograph, estimate anything from one, identify a condition or tell you a product
        is safe for you — and it will not pretend otherwise. Anything that looks or feels medical
        belongs with a qualified professional, such as a doctor or a dermatologist.
      </Notice>

      <Card>
        <CardHeader
          title="Your shelf"
          subtitle="Dates come from the packaging and from you. The earlier of the printed expiry and the period-after-opening date is the one used."
        />
        <div className="px-5 pb-5 space-y-4">
          {products.length === 0 ? (
            <EmptyState
              title="Nothing on your shelf yet"
              description="Add a product below. Only the name is required — the dates are there if you want the reminders."
            />
          ) : (
            <ul className="space-y-2">
              {products.map(({ product, expiry }) => (
                <ProductRow
                  key={product.id}
                  product={{
                    id: product.id,
                    name: product.name,
                    brand: product.brand,
                    category: product.category,
                    keyIngredients: product.keyIngredients,
                    openedAt: product.openedAt,
                    expiresAt: product.expiresAt,
                    paoMonths: product.paoMonths,
                    pricePaise: product.pricePaise,
                    runningLow: product.runningLow,
                    notes: product.notes,
                  }}
                  expiry={{ state: expiry.state, reason: expiry.reason }}
                  categories={PRODUCT_CATEGORIES}
                />
              ))}
            </ul>
          )}
        </div>
      </Card>

      {duplicates.length > 0 ? (
        <Card>
          <CardHeader
            title="The same ingredient, more than once"
            subtitle="Plain text matching on the ingredient names you typed. Not an interaction check and not advice."
          />
          <div className="px-5 pb-5 space-y-2">
            <ul className="space-y-1.5 text-sm">
              {duplicates.slice(0, 8).map((group) => (
                <li key={group.ingredient} className="rounded-lg border border-[var(--border)] px-3 py-2">
                  <span className="font-medium">{group.ingredient}</span>
                  <span className="block text-xs text-[var(--text-muted)] mt-0.5">
                    {group.products.map((p) => p.name).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--text-muted)]">
              GymOS has no ingredient database. This compares the strings you entered and nothing
              else, so it will miss synonyms and cannot tell you whether using both matters.
            </p>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Add a product" />
        <div className="px-5 pb-5">
          <ProductForm categories={PRODUCT_CATEGORIES} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Journal"
          subtitle="One entry a day, in your own words. Saving again for the same date updates that entry."
        />
        <div className="px-5 pb-5 space-y-4">
          <JournalForm today={today} products={productOptions} entry={todayEntry} />
          <p className="text-xs text-[var(--text-muted)]">
            Photographs are not part of this journal: there is nowhere in the database to attach one
            to an entry, so GymOS does not offer it rather than quietly dropping your file. The
            private photo check-in feature exists separately, is 18+ and consent-gated, and every
            part of this page works without it.
          </p>
          {journal.length === 0 ? (
            <EmptyState title="No entries yet" description="Your first entry can be one line." />
          ) : (
            <ul className="space-y-2">
              {journal.map((entry) => (
                <JournalEntryRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Patch tests"
          subtitle="A timer and a place to write down what you saw. Nothing is concluded before the window closes, and nothing is ever marked safe."
        />
        <div className="px-5 pb-5 space-y-4">
          <PatchTestForm
            products={productOptions}
            windowOptions={PATCH_TEST_WINDOW_HOURS}
            defaultWindowHours={DEFAULT_PATCH_TEST_WINDOW_HOURS}
          />
          {patchTests.length === 0 ? (
            <EmptyState
              title="No patch tests"
              description="Start one when you try something new. GymOS will not tell you the result — you record what you see."
            />
          ) : (
            <ul className="space-y-2">
              {patchTests.map(({ test, verdict }) => (
                <PatchTestRow key={test.id} test={test} verdict={verdict} />
              ))}
            </ul>
          )}
          <p className="text-xs text-[var(--text-muted)]">
            A patch test on one small area over one window is not a safety guarantee and not a
            diagnosis. If you see a reaction that is painful, spreading or not settling, stop and see
            a qualified professional.
          </p>
        </div>
      </Card>

      <Notice tone="neutral">
        Routines that use these products live on the{' '}
        <Link href="/grooming" className="underline">
          grooming page
        </Link>
        .
      </Notice>
    </div>
  );
}
