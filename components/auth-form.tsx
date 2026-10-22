'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Button, Card, Checkbox, Field, Input, Notice } from '@/components/ui';
import type { AuthFormState } from '@/app/(auth)/actions';

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function AuthForm({
  mode,
  action,
}: {
  mode: 'login' | 'signup';
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
}) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});
  const isSignup = mode === 'signup';

  return (
    <Card className="p-6 sm:p-7">
      <h1 className="text-2xl font-semibold tracking-tight">
        {isSignup ? 'Create your GymOS account' : 'Welcome back'}
      </h1>
      <p className="text-sm text-[var(--text-muted)] mt-2">
        {isSignup
          ? 'Free, and no payment details are involved — payments are not enabled in this build.'
          : 'Sign in to pick up where you left off.'}
      </p>

      {state.error ? (
        <Notice tone="bad" className="mt-5">
          {state.error}
        </Notice>
      ) : null}

      <form action={formAction} className="mt-5 space-y-4" noValidate>
        <Field label="Email" htmlFor="email" required error={state.field === 'email' ? state.error : undefined}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state.values?.email}
            placeholder="you@example.com"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          required
          hint={isSignup ? 'At least 10 characters. Avoid anything you have used elsewhere.' : undefined}
          error={state.field === 'password' ? state.error : undefined}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            minLength={isSignup ? 10 : undefined}
          />
        </Field>

        {isSignup ? (
          <label className="flex items-start gap-3 text-sm">
            <Checkbox name="acceptTerms" required className="mt-0.5" />
            <span className="text-[var(--text-muted)] leading-relaxed">
              I accept the{' '}
              <Link href="/terms" className="text-[var(--accent)] hover:underline">
                terms
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="text-[var(--accent)] hover:underline">
                privacy policy
              </Link>
              , and I understand GymOS gives general fitness information, not medical advice.
            </span>
          </label>
        ) : null}

        <SubmitButton
          label={isSignup ? 'Create account' : 'Sign in'}
          pendingLabel={isSignup ? 'Creating…' : 'Signing in…'}
        />
      </form>

      <p className="text-sm text-[var(--text-muted)] mt-5 text-center">
        {isSignup ? (
          <>
            Already have an account?{' '}
            <Link href="/login" className="text-[var(--accent)] hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to GymOS?{' '}
            <Link href="/signup" className="text-[var(--accent)] hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </Card>
  );
}
