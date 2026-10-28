import { NextResponse } from 'next/server';
import { requireUser, AuthError } from '@/lib/auth/session';
import { assertSameOriginStrict, CsrfError } from '@/lib/auth/guard';
import {
  storeMedia,
  listMedia,
  mediaUsage,
  MediaPolicyError,
  MAX_IMAGE_BYTES,
  MAX_AUDIO_BYTES,
} from '@/lib/services/media';
import { EntitlementError } from '@/lib/services/entitlements';

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(
      { assets: listMedia(user.id), usage: mediaUsage(user.id) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json({ error: 'Your files could not be listed.' }, { status: 500 });
  }
}

/**
 * Upload endpoint for private media.
 *
 * A route handler rather than a Server Action because Server Actions buffer the whole
 * body into the action payload; this reads the file once and hands the bytes straight
 * to the service, which strips metadata and encrypts before anything hits the disk.
 */
export async function POST(request: Request) {
  try {
    await assertSameOriginStrict();
    const user = await requireUser();

    const type = request.headers.get('content-type') ?? '';
    if (!type.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Send the file as multipart/form-data.' }, { status: 415 });
    }

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_IMAGE_BYTES + MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'That upload is too large.' }, { status: 413 });
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was attached.' }, { status: 400 });
    }

    const kindRaw = String(form.get('kind') ?? '');
    if (kindRaw !== 'photo' && kindRaw !== 'audio') {
      return NextResponse.json({ error: 'Specify kind as photo or audio.' }, { status: 400 });
    }

    const durationRaw = form.get('durationSeconds');
    const duration = durationRaw === null ? undefined : Number(durationRaw);

    const stored = storeMedia(user.id, user.plan, {
      kind: kindRaw,
      mimeType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
      originalFilename: file.name,
      durationSeconds: Number.isFinite(duration) && duration !== undefined ? Math.round(duration) : undefined,
      consent: kindRaw === 'photo' ? 'photo_journal' : 'voice_recording',
    });

    return NextResponse.json(stored, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof CsrfError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof MediaPolicyError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message, upgrade: true }, { status: 402 });
    }
    return NextResponse.json({ error: 'That file could not be saved.' }, { status: 500 });
  }
}
