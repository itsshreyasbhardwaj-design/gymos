/**
 * Hard safety suite for the photo journal.
 *
 * GymOS stores a person's own photographs so that THEY can look back at them. It is
 * not an analyser, and it must not quietly become one. Precisely what this suite
 * checks, so that nobody reads more assurance into it than it gives:
 *
 *   - NAMES. The schema is scanned PROGRAMMATICALLY — every exported Drizzle table,
 *     every column, by both its TypeScript key and its SQL name — for anything that
 *     could hold an appearance score, attractiveness rating, body-shape grade or
 *     body-fat estimate. A migration that adds such a column fails this suite even if
 *     no code ever reads it. The journal service's public surface is pinned to an
 *     explicit list, so a new export cannot slip in unreviewed, and no exported name
 *     may suggest scoring, rating, measuring, detecting or diagnosing anything.
 *   - SHAPES. Every value a journal read returns is pinned member by member. The name
 *     checks above only catch a telling name; this one catches a neutral one, so a
 *     fabricated number added to an existing return type fails whatever it is called.
 *     The same shapes are pinned again at runtime, against real rows, in
 *     tests/integration/journal.test.ts.
 *   - SOURCE. The service source (comments stripped, so the prose explaining the ban
 *     cannot satisfy the check) must contain no scoring identifier and no network call.
 *   - KEEPING. Storing a photograph is irreversible the moment it lands, so the last
 *     section guards the client flow that uploads one: whatever happens — a refusal, a
 *     dropped connection, an expired session, a cleanup that itself fails — the
 *     uploads must be taken back, the user must be told, and a retry must never store
 *     a second copy of a file that is still on disk. Those are exercised as functions,
 *     with upload/save/delete injected, so nothing here touches the network.
 *
 * What this suite does NOT do: prove that nothing anywhere in GymOS analyses a
 * photograph. It guards this service's schema, surface, return shapes and source. A
 * capability added in another module is another module's test's job.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getTableColumns, getTableName, is, Table } from 'drizzle-orm';
import { createTempDatabase } from '../helpers/test-db';

// The journal service reaches lib/db/client at import time; point it at a throwaway
// file so importing the module never touches a real database.
const temp = createTempDatabase();

let schema: typeof import('@/lib/db/schema');
let journal: typeof import('@/lib/services/journal');
let journalForm: typeof import('@/components/photo-journal');
let checkinForm: typeof import('@/components/checkin-forms');

/**
 * Substrings that must never appear in a column name or an exported symbol.
 *
 * Deliberately broad. If a future feature genuinely needs one of these words, the
 * right response is a conversation about whether GymOS should be doing it at all —
 * not an edit to this list.
 */
const FORBIDDEN_SUBSTRINGS = [
  'appearance',
  'attractive',
  'attractiveness',
  'beauty',
  'hotness',
  'looksmax',
  'lookism',
  'bodyfat',
  'body_fat',
  'physique',
  'symmetry',
  'facial',
  'faceshape',
  'face_shape',
  'jawline',
  'score',
  'rating',
  'ranking',
  'percentile',
  'aesthetic',
  'prettiness',
  'desirability',
  'sexiness',
];

/**
 * Short words that must be matched as whole words, not substrings: "bmi" is inside
 * "submittedByUserId" and "grade" is inside "upgrade", and a guard that cries wolf
 * is a guard somebody eventually deletes.
 */
const FORBIDDEN_WORDS = ['bmi', 'grade', 'rank', 'ugly', 'ideal', 'score', 'rated', 'rating'];

/**
 * A rating is allowed in exactly one shape: one the user typed about themselves, with
 * a name that says so (`selfRatedClarity`). Anything GymOS computed about a person is
 * not allowed at all, so the exemption is keyed on the `self` prefix and nothing else.
 */
function isSelfReported(identifier: string): boolean {
  return wordsOf(identifier)[0] === 'self';
}

/** Splits an identifier or a line of code into lower-case words. */
function wordsOf(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function violationsIn(label: string, value: string, selfReported = false): string[] {
  const haystack = value.toLowerCase();
  const found: string[] = [];
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (haystack.includes(forbidden)) found.push(`${label} matches "${forbidden}"`);
  }
  const words = new Set(wordsOf(value));
  for (const forbidden of FORBIDDEN_WORDS) {
    if (selfReported && (forbidden === 'rated' || forbidden === 'rating')) continue;
    if (words.has(forbidden)) found.push(`${label} matches the word "${forbidden}"`);
  }
  return found;
}

/** Verbs that would mean GymOS had started judging a photograph. */
const FORBIDDEN_CAPABILITY_WORDS = [
  'analyse',
  'analyze',
  'analysis',
  'classify',
  'detect',
  'recognise',
  'recognize',
  'estimate',
  'predict',
  'infer',
  'diagnose',
  'diagnosis',
  'transcribe',
  'transcription',
  'measurephoto',
  'ratephoto',
  'scorephoto',
];

/**
 * The complete public surface of the journal service.
 *
 * Pinned on purpose: adding an export means updating this list, which puts the new
 * capability in front of a reviewer instead of letting it arrive silently.
 */
const EXPECTED_EXPORTS = [
  'CADENCE_LABELS',
  'MAX_PHOTOS_PER_CHECKIN',
  'JOURNAL_CATEGORIES',
  'PHOTO_VIEW_LABELS',
  'checkinOutlook',
  'comparePhotoCheckins',
  'createJournalEntry',
  'createPhotoCheckin',
  'deleteJournalEntry',
  'deletePhotoCheckin',
  'disableCheckins',
  'getCheckinSchedule',
  'getJournalEntry',
  'getPhotoCheckin',
  'journalSummary',
  'listJournalEntries',
  'listPhotoCheckins',
  'removeCheckinPhoto',
  'setCheckinSchedule',
  'todayIso',
  'updateCheckinNote',
  'updateJournalEntry',
];

/**
 * Every member of every shape a journal READ returns.
 *
 * Structural, not lexical: this is the check that fails when a derived number arrives
 * under a harmless name. `consistency`, `trend`, `index`, `delta` — none of them trip a
 * wordlist, and all of them fail here, because the member list has to match exactly.
 * Adding a member means editing this list, which is the review.
 *
 * `daysApart` and the counts are the only numbers allowed, and every one of them is
 * calendar arithmetic or a count of rows the user created.
 */
const EXPECTED_READ_SHAPES: Record<string, string[]> = {
  JournalPhotoView: ['assetId', 'checkinId', 'date', 'view', 'caption', 'mimeType', 'createdAt'],
  JournalEntryView: [
    'id',
    'date',
    'category',
    'title',
    'body',
    'tags',
    'createdAt',
    'updatedAt',
    'photos',
  ],
  CheckinPhotoView: ['assetId', 'view', 'caption', 'mimeType', 'byteSize', 'createdAt'],
  CheckinView: ['id', 'date', 'note', 'createdAt', 'photos'],
  CheckinComparison: ['earlier', 'later', 'daysApart', 'analysis'],
  CheckinScheduleView: [
    'cadence',
    'customDays',
    'reminderTime',
    'lastPromptedAt',
    'updatedAt',
    'intervalDays',
  ],
  CheckinOutlook: [
    'cadence',
    'intervalDays',
    'reminderTime',
    'lastCheckinDate',
    'nextSuggestedDate',
    'dueToday',
  ],
  JournalSummary: [
    'entryCount',
    'checkinCount',
    'photoCount',
    'lastEntryDate',
    'lastCheckinDate',
  ],
};

/** Shapes the USER fills in, which say nothing about what GymOS derives. */
const INPUT_SHAPES = ['JournalPhotoRef', 'JournalEntryInput', 'CheckinInput'];

const SERVICE_PATH = path.join(process.cwd(), 'lib', 'services', 'journal.ts');

/** Comments go first: the prose explaining what GymOS refuses to do is not a violation. */
function sourceWithoutComments(filePath: string): string {
  return fs
    .readFileSync(filePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** The declared members of one `export interface`, in source order. */
function interfaceMembers(source: string, name: string): string[] {
  const match = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!match?.[1]) throw new Error(`interface ${name} is not declared in journal.ts`);
  return [...match[1].matchAll(/^\s*(\w+)\??\s*:/gm)].map((member) => member[1] as string);
}

beforeAll(async () => {
  schema = await import('@/lib/db/schema');
  journal = await import('@/lib/services/journal');
  journalForm = await import('@/components/photo-journal');
  checkinForm = await import('@/components/checkin-forms');
});

describe('what a journal read returns is pinned shape by shape', () => {
  it('declares exactly the reviewed members, so a neutrally-named metric still fails', () => {
    const source = sourceWithoutComments(SERVICE_PATH);
    for (const [name, expected] of Object.entries(EXPECTED_READ_SHAPES)) {
      const actual = interfaceMembers(source, name);
      // Parsed something real, so a renamed interface cannot turn this into a no-op.
      expect(actual.length, `${name} has no members`).toBeGreaterThan(0);
      expect([...actual].sort(), `${name} members`).toEqual([...expected].sort());
    }
  });

  it('covers every read shape the service declares, so a new one cannot arrive unpinned', () => {
    const declared = [
      ...sourceWithoutComments(SERVICE_PATH).matchAll(/export interface (\w+)/g),
    ].map((match) => match[1] as string);
    expect(declared.length).toBe(Object.keys(EXPECTED_READ_SHAPES).length + INPUT_SHAPES.length);
    expect(declared.filter((name) => !INPUT_SHAPES.includes(name)).sort()).toEqual(
      Object.keys(EXPECTED_READ_SHAPES).sort(),
    );
  });

  it('allows no number in a read shape beyond calendar arithmetic and row counts', () => {
    const source = sourceWithoutComments(SERVICE_PATH);
    const numeric: string[] = [];
    for (const name of Object.keys(EXPECTED_READ_SHAPES)) {
      const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source);
      for (const line of (body?.[1] ?? '').split('\n')) {
        const member = /^\s*(\w+)\??\s*:\s*number/.exec(line);
        if (member?.[1]) numeric.push(`${name}.${member[1]}`);
      }
    }
    // Every number a read returns, named one by one. A new one fails until someone
    // writes down here what it is and where it came from.
    expect(numeric.sort()).toEqual(
      [
        'CheckinComparison.daysApart', // days between two dates the user chose
        'CheckinPhotoView.byteSize', // the size of the user's own file
        'CheckinOutlook.intervalDays', // the cadence the user asked for
        'CheckinScheduleView.customDays', // the cadence the user typed
        'CheckinScheduleView.intervalDays', // the same cadence, resolved
        'JournalSummary.checkinCount', // rows the user created
        'JournalSummary.entryCount', // rows the user created
        'JournalSummary.photoCount', // files the user uploaded
      ].sort(),
    );
  });
});

describe('the schema cannot store an appearance judgement', () => {
  it('finds the tables to scan, so a silent no-op cannot pass this suite', () => {
    const tables = Object.values(schema).filter((value) => is(value as never, Table));
    expect(tables.length).toBeGreaterThan(50);
    // The journal tables specifically are among them.
    const names = tables.map((table) => getTableName(table as never));
    expect(names).toContain('personal_journal_entries');
    expect(names).toContain('photo_checkins');
    expect(names).toContain('photo_checkin_assets');
    expect(names).toContain('checkin_schedules');
    expect(names).toContain('private_media_assets');
  });

  it('has no column in ANY table whose name suggests a score, rating or body-fat estimate', () => {
    const violations: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value as never, Table)) continue;
      const tableName = getTableName(value as never);
      for (const [key, column] of Object.entries(getTableColumns(value as never))) {
        violations.push(
          ...violationsIn(
            `${tableName}.${key}`,
            `${key} ${(column as { name: string }).name}`,
            isSelfReported(key),
          ),
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('has no table whose own name suggests appearance scoring', () => {
    const violations: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value as never, Table)) continue;
      const tableName: string = getTableName(value as never);
      violations.push(...violationsIn(tableName, tableName));
      for (const forbidden of FORBIDDEN_CAPABILITY_WORDS) {
        if (tableName.toLowerCase().includes(forbidden)) {
          violations.push(`${tableName} matches "${forbidden}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('allows a rating column only when its name says the user supplied it', () => {
    const rated: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value as never, Table)) continue;
      const tableName = getTableName(value as never);
      for (const key of Object.keys(getTableColumns(value as never))) {
        const words = new Set(wordsOf(key));
        if (words.has('rated') || words.has('rating')) {
          rated.push(`${tableName}.${key}`);
          // Not merely containing "self": the FIRST word must be `self`, so a
          // computed value cannot be smuggled in as `clarityRatingSelf`.
          expect(isSelfReported(key), `${tableName}.${key} must be self-reported`).toBe(true);
        }
      }
    }
    // The scan found something, so a rename cannot turn this test into a no-op.
    expect(rated.length).toBeGreaterThan(0);
  });

  it('keeps the only user-entered 1-5 field a self-reported comfort value, not a quality score', () => {
    const columns = Object.keys(getTableColumns(schema.skincareJournal));
    expect(columns).toContain('comfort');
    for (const column of columns) {
      expect(column.toLowerCase()).not.toContain('score');
      expect(column.toLowerCase()).not.toContain('quality');
    }
  });
});

describe('the journal service exposes no scoring capability', () => {
  it('exports exactly the reviewed surface and nothing more', () => {
    expect(Object.keys(journal).sort()).toEqual([...EXPECTED_EXPORTS].sort());
  });

  it('has no exported name suggesting a score, rating or grade', () => {
    const violations = Object.keys(journal).flatMap((name) => violationsIn(`export ${name}`, name));
    expect(violations).toEqual([]);
  });

  it('has no exported name suggesting analysis, recognition or diagnosis', () => {
    for (const name of Object.keys(journal)) {
      const lower = name.toLowerCase();
      for (const forbidden of FORBIDDEN_CAPABILITY_WORDS) {
        expect(lower, `export "${name}" matches "${forbidden}"`).not.toContain(forbidden);
      }
    }
  });

  it('exports only functions and plain constants — no object that could carry a scorer', () => {
    for (const [name, value] of Object.entries(journal)) {
      const kind = typeof value;
      expect(['function', 'object', 'number'], `export "${name}" is a ${kind}`).toContain(kind);
      if (kind === 'object') {
        // The only non-function exports are the label/category constants.
        expect(['JOURNAL_CATEGORIES', 'CADENCE_LABELS', 'PHOTO_VIEW_LABELS']).toContain(name);
      }
    }
  });

  it('declares its comparison result as carrying no analysis', () => {
    // The type is erased at runtime, so the guarantee is pinned in the source: the
    // comparison result's `analysis` member exists only to be null.
    const source = sourceWithoutComments(SERVICE_PATH);
    expect(source).toContain('analysis: null');
  });
});

describe('the journal service source contains no scoring or network code', () => {
  it('reads the service it is guarding, so the scan cannot silently scan nothing', () => {
    const source = sourceWithoutComments(SERVICE_PATH);
    expect(source.length).toBeGreaterThan(2000);
    expect(source).toContain('createPhotoCheckin');
  });

  it('contains no scoring, rating or body-fat identifier once comments are stripped', () => {
    const source = sourceWithoutComments(SERVICE_PATH);
    const violations = violationsIn('journal.ts', source).filter(
      // `analysis: null` is the explicit denial, and FORBIDDEN_WORDS includes "score"
      // only to catch an identifier — the word never appears in this file's code.
      (violation) => !violation.includes('"analysis"'),
    );
    expect(violations).toEqual([]);
  });

  it('contains no analysis, recognition, transcription or diagnosis identifier', () => {
    const source = sourceWithoutComments(SERVICE_PATH).toLowerCase();
    for (const forbidden of FORBIDDEN_CAPABILITY_WORDS) {
      if (forbidden === 'analysis') continue; // `analysis: null` is the explicit denial.
      expect(source, `journal.ts contains "${forbidden}" in code`).not.toContain(forbidden);
    }
  });

  it('makes no network call and loads no model', () => {
    const source = sourceWithoutComments(SERVICE_PATH).toLowerCase();
    for (const forbidden of ['fetch(', 'http://', 'https://', 'xmlhttprequest', 'onnx', 'tensorflow', 'openai']) {
      expect(source, `journal.ts references "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('writes private media only through the media service', () => {
    const source = sourceWithoutComments(SERVICE_PATH);
    // No direct insert or update of the media tables: the media service owns the
    // 18+ rule, consent, encryption, metadata stripping and auditable deletion.
    expect(source).not.toMatch(/insert\(\s*privateMediaAssets/);
    expect(source).not.toMatch(/update\(\s*privateMediaAssets/);
    expect(source).not.toMatch(/delete\(\s*privateMediaAssets/);
    expect(source).not.toMatch(/insert\(\s*mediaDeletionEvents/);
    expect(source).not.toMatch(/insert\(\s*mediaAccessGrants/);
    expect(source).toContain("from './media'");
  });

  it('builds no public URL for a photograph', () => {
    const source = sourceWithoutComments(SERVICE_PATH);
    expect(source).not.toContain('/api/media/');
    expect(source).not.toContain('storagePath');
  });
});

describe('check-ins stay opt-in', () => {
  it('declares off as the first cadence and the stored default', () => {
    expect(schema.CHECKIN_CADENCES[0]).toBe('off');
    expect(schema.checkinSchedules.cadence.default).toBe('off');
    expect(journal.CADENCE_LABELS.off.toLowerCase()).toContain('off');
  });

  it('offers a one-call way to turn them off', () => {
    expect(typeof journal.disableCheckins).toBe('function');
  });

  it('keeps every cadence the schema allows reachable, including off', () => {
    for (const cadence of schema.CHECKIN_CADENCES) {
      expect(Object.keys(journal.CADENCE_LABELS)).toContain(cadence);
    }
  });
});

/* ==========================================================================
 * An uploaded photograph is never silently kept.
 *
 * `POST /api/media` stores a file permanently the moment it returns. The client flow
 * that does the uploading therefore owes the user two things on every single path out
 * of it: the uploads taken back, and a sentence saying what happened. These tests
 * drive the flow directly with upload/save/delete injected, which is where the
 * behaviour actually lives — a rendered form would only show it second-hand.
 * ========================================================================== */

/** A fake JPEG, so the real `FormData` assembly runs on a real `File`. */
function photoFile(name: string): File {
  return new File([Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)], name, { type: 'image/jpeg' });
}

/** Swaps in a scripted `fetch` for the duration of one call, then restores the real one. */
async function withFetch<T>(
  handler: (url: string, method: string) => Promise<Response> | Response,
  body: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { method?: string }) =>
    handler(String(input), init?.method ?? 'GET')) as unknown as typeof fetch;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
}

function ok(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('an upload is taken back however the save ends', () => {
  it('takes back every photograph already uploaded when the save itself THROWS', async () => {
    // The real throw this guards: a session that expired between the upload and the
    // save. Before the fix the ids lived in a function-local array, the rejection
    // escaped the submit handler, the files stayed on disk and the form said nothing.
    const discarded: string[][] = [];
    const result = await journalForm.attemptMediaSave({
      upload: async (stored) => {
        stored('asset-1');
        stored('asset-2');
        return {};
      },
      save: async () => {
        throw new Error('Session expired');
      },
      discard: async (ids) => {
        discarded.push([...ids]);
        return { kept: [], message: ' Nothing was kept.' };
      },
      fallbackError: 'That entry could not be saved.',
    });

    expect(discarded).toEqual([['asset-1', 'asset-2']]);
    expect(result.state.error).toContain('That entry could not be saved.');
    expect(result.state.error).toContain('Session expired');
    expect(result.state.error).toContain('Nothing was kept.');
    expect(result.state.success).toBeUndefined();
  });

  it('takes back the photographs already uploaded when the UPLOAD throws partway through', async () => {
    const discarded: string[][] = [];
    let saveCalled = false;
    const outcome = await journalForm.attemptMediaSave({
      upload: async (stored) => {
        stored('asset-1');
        throw new Error('Failed to fetch');
      },
      save: async () => {
        saveCalled = true;
        return { success: 'saved' };
      },
      discard: async (ids) => {
        discarded.push([...ids]);
        return { kept: [...ids], message: ' 1 of 1 uploaded photo(s) could not be deleted.' };
      },
      fallbackError: 'That check-in could not be saved.',
    });

    // The id that landed before the drop is still reachable, so it can still be deleted.
    expect(discarded).toEqual([['asset-1']]);
    expect(saveCalled).toBe(false);
    expect(outcome.state.error).toContain('could not be deleted');
  });

  it('never comes back silent, whatever was thrown', async () => {
    for (const thrown of [new Error('Session expired'), new Error('   '), 'a bare string', 7, null]) {
      const result = await journalForm.attemptMediaSave({
        upload: async () => {
          throw thrown;
        },
        save: async () => ({ success: 'saved' }),
        discard: async () => ({ kept: [], message: '' }),
        fallbackError: 'That entry could not be saved.',
      });
      expect(result.state.error, `thrown: ${String(thrown)}`).toBeTruthy();
      expect(result.state.success, `thrown: ${String(thrown)}`).toBeUndefined();
    }
  });

  it('still reports, and still clears the selection, when the cleanup itself cannot run', async () => {
    const result = await journalForm.attemptMediaSave({
      upload: async (stored) => {
        stored('asset-1');
        return {};
      },
      save: async () => ({ error: 'The server refused this entry.' }),
      discard: async () => {
        throw new Error('offline');
      },
      fallbackError: 'That entry could not be saved.',
    });

    expect(result.state.error).toContain('The server refused this entry.');
    // Nothing could be deleted, so the user is told where the file is.
    expect(result.state.error).toContain('Media privacy');
    expect(result.clearSelection).toBe(true);
  });

  it('passes a refusal through and reports the save as failed, not saved', async () => {
    const result = await journalForm.attemptMediaSave({
      upload: async () => ({}),
      save: async () => ({ error: 'Write a title or a note before saving.' }),
      discard: async () => ({ kept: [], message: '' }),
      fallbackError: 'That entry could not be saved.',
    });
    expect(result.state.error).toBe('Write a title or a note before saving.');
    expect(result.clearSelection).toBe(false);
  });

  it('hands the saved state straight back and forgets the files', async () => {
    let discardCalled = false;
    const result = await journalForm.attemptMediaSave({
      upload: async (stored) => {
        stored('asset-1');
        return {};
      },
      save: async (ids) => ({ success: `saved with ${ids.join(',')}` }),
      discard: async () => {
        discardCalled = true;
        return { kept: [], message: '' };
      },
      fallbackError: 'That entry could not be saved.',
    });
    expect(result.state.success).toBe('saved with asset-1');
    expect(discardCalled).toBe(false);
    expect(result.clearSelection).toBe(true);
  });
});

describe('a retry cannot store a second copy of a photograph', () => {
  /** One refused save, with `kept` deciding what the cleanup managed to remove. */
  const refusedSave = (kept: string[]) =>
    journalForm.attemptMediaSave({
      upload: async (stored) => {
        stored('a');
        stored('b');
        return {};
      },
      save: async () => ({ error: 'The server refused this entry.' }),
      discard: async () => ({
        kept,
        message: kept.length === 0 ? ' Nothing was kept.' : ' Some files could not be deleted.',
      }),
      fallbackError: 'That entry could not be saved.',
    });

  it('keeps the chosen files when every upload was deleted again, so a retry stores one copy', async () => {
    const result = await refusedSave([]);
    expect(result.clearSelection).toBe(false);
  });

  it('drops the chosen files when an upload survived, because re-uploading would duplicate it', async () => {
    // This is the partial-failure branch. The old code kept the selection here too,
    // so pressing Save again uploaded a second copy of exactly the file whose delete
    // had failed — the one copy the user could not get rid of.
    const result = await refusedSave(['b']);
    expect(result.clearSelection).toBe(true);
  });

  it('tells the user the files are stored, where they are, and that the selection is gone', async () => {
    const outcome = await withFetch(
      async (url) => (url.endsWith('/kept') ? new Response('', { status: 500 }) : ok({})),
      () => journalForm.discardUploads(['gone', 'kept'], 'save'),
    );
    expect(outcome.kept).toEqual(['kept']);
    expect(outcome.message).toContain('could not be deleted automatically');
    expect(outcome.message).toContain('Settings → Media privacy');
    expect(outcome.message).toContain('cleared');
    expect(outcome.message).toContain('second copy');
  });
});

describe('discarding uploads reports what really happened', () => {
  it('deletes each id with DELETE and counts a failed response as still stored', async () => {
    const seen: string[] = [];
    const outcome = await withFetch(
      async (url, method) => {
        seen.push(`${method} ${url}`);
        if (url.endsWith('/removed')) return new Response('', { status: 200 });
        if (url.endsWith('/refused')) return new Response('', { status: 403 });
        throw new Error('network down');
      },
      () => journalForm.discardUploads(['removed', 'refused', 'dropped'], 'check-in'),
    );

    expect(seen).toEqual([
      'DELETE /api/media/removed',
      'DELETE /api/media/refused',
      'DELETE /api/media/dropped',
    ]);
    // A non-ok response and a thrown request both mean the file is still there.
    expect(outcome.kept).toEqual(['refused', 'dropped']);
  });

  it('says nothing was kept, and keeps quiet about Media privacy, when every delete worked', async () => {
    const outcome = await withFetch(
      async () => new Response('', { status: 200 }),
      () => journalForm.discardUploads(['one', 'two'], 'check-in'),
    );
    expect(outcome.kept).toEqual([]);
    expect(outcome.message).toContain('Nothing was kept');
    expect(outcome.message).toContain('2 photo(s) uploaded for this check-in');
  });

  it('says nothing at all, and calls nothing at all, when no photograph was uploaded', async () => {
    let calls = 0;
    const outcome = await withFetch(
      async () => {
        calls += 1;
        return new Response('', { status: 200 });
      },
      () => journalForm.discardUploads([], 'save'),
    );
    expect(calls).toBe(0);
    expect(outcome).toEqual({ kept: [], message: '' });
  });
});

describe('an upload reports each stored id as it lands', () => {
  it('keeps the first id when the second request throws — in BOTH forms', async () => {
    // The id must leave `uploadPhotos` as it is stored, not on return: a connection
    // that drops on the second file must not take the first file's id with it.
    const script = () => {
      let call = 0;
      return async () => {
        call += 1;
        if (call === 1) return ok({ id: 'first' });
        throw new Error('connection reset');
      };
    };

    const journalIds: string[] = [];
    const journalResult = await withFetch(script(), () =>
      journalForm.uploadPhotos([photoFile('a.jpg'), photoFile('b.jpg')], (id) =>
        journalIds.push(id),
      ),
    );
    expect(journalIds).toEqual(['first']);
    expect(journalResult.error).toContain('Settings → Media privacy');

    const checkinIds: string[] = [];
    const checkinResult = await withFetch(script(), () =>
      checkinForm.uploadPhotos(
        [
          { file: photoFile('a.jpg'), view: 'front' },
          { file: photoFile('b.jpg'), view: 'side' },
        ],
        (photo) => checkinIds.push(photo.id),
      ),
    );
    expect(checkinIds).toEqual(['first']);
    expect(checkinResult.error).toContain('Settings → Media privacy');
  });

  it('keeps the first id when the second request is refused, and passes the reason on', async () => {
    let call = 0;
    const ids: string[] = [];
    const result = await withFetch(
      async () => {
        call += 1;
        return call === 1
          ? ok({ id: 'first' })
          : new Response(JSON.stringify({ error: 'Your plan holds 20 files.' }), {
              status: 402,
              headers: { 'content-type': 'application/json' },
            });
      },
      () => journalForm.uploadPhotos([photoFile('a.jpg'), photoFile('b.jpg')], (id) => ids.push(id)),
    );
    expect(ids).toEqual(['first']);
    expect(result.error).toBe('Your plan holds 20 files.');
  });

  it('stops at the first failure instead of uploading the rest', async () => {
    let calls = 0;
    const ids: string[] = [];
    await withFetch(
      async () => {
        calls += 1;
        return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
      },
      () =>
        journalForm.uploadPhotos(
          [photoFile('a.jpg'), photoFile('b.jpg'), photoFile('c.jpg')],
          (id) => ids.push(id),
        ),
    );
    expect(calls).toBe(1);
    expect(ids).toEqual([]);
  });
});

describe('both photo forms share the one upload-then-save flow', () => {
  it('leaves no second copy of the flow to forget the cleanup in', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components', 'checkin-forms.tsx'),
      'utf8',
    );
    expect(source).toContain("from '@/components/photo-journal'");
    expect(source).toContain('attemptMediaSave');
    // No private copy of the cleanup, and no delete call of its own.
    expect(source).not.toMatch(/function discardUploads/);
    expect(source).not.toContain("method: 'DELETE'");
  });
});

afterAll(() => temp.cleanup());
