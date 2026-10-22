import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { checkPublicRateLimit } from '@/lib/auth/public-rate-limit';
import { hashIp } from '@/lib/auth/ids';
import { clientIp } from '@/lib/auth/session';
import { generatePlan } from '@/lib/engines/workout-generator';
import { expandEquipment } from '@/lib/engines/equipment';
import { EQUIPMENT_PRESETS } from '@/lib/content/equipment';
import { mondayOf } from '@/lib/engines/nutrition';

/**
 * Public preview endpoint for the homepage.
 *
 * It runs the real generator — the same code signed-in users get — against a
 * visitor-chosen equipment preset. It touches no database and stores nothing.
 */
const Body = z.object({
  preset: z.enum(['bodyweight_home', 'minimal_home', 'garage_gym', 'apartment_gym', 'commercial_gym', 'travel', 'outdoor']),
  minutes: z.number().int().min(15).max(120),
  experience: z.enum(['new', 'some', 'regular', 'experienced']),
  days: z.number().int().min(1).max(6),
  interests: z.array(z.string()).max(6).default([]),
});

export async function POST(request: Request) {
  // The generator is CPU-bound and this endpoint is unauthenticated, so it is capped.
  const hdrs = await headers();
  const limit = checkPublicRateLimit(`preview:${hashIp(clientIp(hdrs)) ?? 'unknown'}`, 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many preview requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid preview options.' }, { status: 400 });
  }
  const { preset, minutes, experience, days, interests } = parsed.data;
  const ids = EQUIPMENT_PRESETS[preset]?.ids ?? [];
  const trainingDays = [1, 3, 5, 2, 4, 6].slice(0, days).sort((a, b) => a - b);

  const plan = generatePlan({
    profile: {
      // A stable, obviously-fake id: the preview is deterministic and never stored.
      userId: `preview:${preset}:${experience}`,
      ageBand: 'adult_18_plus',
      experience,
      interests,
      trainingDays,
      sessionMinutes: minutes,
      limitations: [],
    },
    availableEquipment: expandEquipment(ids),
    gymProfileName: EQUIPMENT_PRESETS[preset]?.label,
    weekStart: mondayOf(new Date().toISOString().slice(0, 10)),
  });

  return NextResponse.json(
    {
      example: true,
      note: 'Example output from the real GymOS generator. Nothing was saved.',
      splitKind: plan.splitKind,
      generatorVersion: plan.generatorVersion,
      equipmentCount: ids.length,
      explanation: plan.explanation,
      warnings: plan.warnings,
      days: plan.days
        .filter((d) => !d.isRest)
        .map((d) => ({
          label: d.label,
          focusLabel: d.focusLabel,
          estimatedMinutes: d.estimatedMinutes,
          targetMinutes: d.targetMinutes,
          gaps: d.gaps,
          exercises: d.exercises.map((e) => ({
            name: e.name,
            exerciseId: e.exerciseId,
            pattern: e.slotPattern,
            role: e.role,
            sets: e.sets,
            repsLow: e.repsLow ?? null,
            repsHigh: e.repsHigh ?? null,
            durationSeconds: e.durationSeconds ?? null,
            restSeconds: e.restSeconds,
            rationale: e.rationale,
          })),
        })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
