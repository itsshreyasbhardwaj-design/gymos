import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { signupAction } from '../actions';
import { getSessionUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Create an account' };

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect('/dashboard');
  return <AuthForm mode="signup" action={signupAction} />;
}
