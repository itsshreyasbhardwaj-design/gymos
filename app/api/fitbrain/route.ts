import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, AuthError } from '@/lib/auth/session';
import { assertSameOrigin, requireJson, CsrfError } from '@/lib/auth/guard';
import { ask } from '@/lib/services/fitbrain';

const Body = z.object({ query: z.string().min(1).max(500) });

export async function POST(request: Request) {
  try {
    await assertSameOrigin();
    await requireJson(request);
    const user = await requireUser();
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Ask a question between 1 and 500 characters.' }, { status: 400 });
    }
    const answer = ask({ userId: user.id, plan: user.plan, query: parsed.data.query });
    return NextResponse.json(answer, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof CsrfError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: 'FitBrain could not answer that.' }, { status: 500 });
  }
}
