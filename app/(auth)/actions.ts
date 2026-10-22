'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { registerUser, authenticate, ValidationError } from '@/lib/services/account';
import { createSession, destroyCurrentSession, audit, clientIp } from '@/lib/auth/session';
import { checkRateLimit, recordAttempt, AUTH_LIMITS } from '@/lib/auth/rate-limit';
import { hashIp, normalizeEmail } from '@/lib/auth/ids';

export interface AuthFormState {
  error?: string;
  field?: string;
  values?: { email?: string };
}

async function ipBucket(action: string): Promise<string> {
  const hdrs = await headers();
  return `${action}:ip:${hashIp(clientIp(hdrs)) ?? 'unknown'}`;
}

export async function signupAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const acceptTerms = formData.get('acceptTerms') === 'on';

  const bucket = await ipBucket('signup');
  const limit = checkRateLimit({ bucket, ...AUTH_LIMITS.signupPerIp });
  if (!limit.allowed) {
    return {
      error: 'Too many accounts have been created from here recently. Try again later.',
      values: { email },
    };
  }

  try {
    const userId = await registerUser({ email, password, acceptTerms });
    recordAttempt(bucket, 'success');
    await audit('auth.signup', { userId });
    await createSession(userId);
  } catch (err) {
    recordAttempt(bucket, 'failure');
    if (err instanceof ValidationError) {
      return { error: err.message, field: err.field, values: { email } };
    }
    return { error: 'Could not create your account. Please try again.', values: { email } };
  }
  redirect('/onboarding');
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const ipKey = await ipBucket('login');
  const accountKey = `login:account:${normalizeEmail(email)}`;
  const ipLimit = checkRateLimit({ bucket: ipKey, ...AUTH_LIMITS.loginPerIp });
  const accountLimit = checkRateLimit({ bucket: accountKey, ...AUTH_LIMITS.loginPerAccount });

  if (!ipLimit.allowed || !accountLimit.allowed) {
    return {
      error: 'Too many failed sign-in attempts. Please wait a few minutes and try again.',
      values: { email },
    };
  }

  const userId = await authenticate(email, password);
  if (!userId) {
    recordAttempt(ipKey, 'failure');
    recordAttempt(accountKey, 'failure');
    // Deliberately identical whether the account exists or the password is wrong.
    return { error: 'That email and password do not match an account.', values: { email } };
  }

  recordAttempt(ipKey, 'success');
  recordAttempt(accountKey, 'success');
  await audit('auth.login', { userId });
  await createSession(userId);
  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect('/');
}
