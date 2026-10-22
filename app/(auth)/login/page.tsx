import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { loginAction } from '../actions';
import { getSessionUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect('/dashboard');
  return <AuthForm mode="login" action={loginAction} />;
}
