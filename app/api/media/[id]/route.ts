import { NextResponse } from 'next/server';
import { requireUser, AuthError } from '@/lib/auth/session';
import { assertSameOriginStrict, CsrfError } from '@/lib/auth/guard';
import { readMedia, deleteMedia, MediaPolicyError } from '@/lib/services/media';
import { MediaIntegrityError } from '@/lib/media/crypto';
import { NotFoundError } from '@/lib/services/equipment';

/**
 * The only way private media is ever served.
 *
 * There is no public URL and no static path: the bytes live encrypted outside the
 * served tree, and every request is authenticated and ownership-checked before a
 * single byte is decrypted. The response is marked private and no-store so it is
 * never written to a shared cache.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const media = readMedia(user.id, id);

    return new NextResponse(new Uint8Array(media.bytes), {
      status: 200,
      headers: {
        'Content-Type': media.mimeType,
        'Content-Length': String(media.bytes.length),
        'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
        'Content-Disposition': `inline; filename="${id}"`,
        'X-Content-Type-Options': 'nosniff',
        // Nothing in a user's own photo or recording should ever be able to run
        // or phone home, even if the stored bytes are not what we think.
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof MediaIntegrityError) {
      return NextResponse.json(
        { error: 'That file failed its integrity check and was not served.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: 'That file could not be read.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await assertSameOriginStrict();
    const user = await requireUser();
    const { id } = await ctx.params;
    const fileRemoved = deleteMedia(user.id, id, 'user_request');
    return NextResponse.json({ deleted: true, fileRemoved }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof CsrfError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof MediaPolicyError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: 'That file could not be deleted.' }, { status: 500 });
  }
}
