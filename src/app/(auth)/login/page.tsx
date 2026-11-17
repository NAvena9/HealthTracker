'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserClient } from '@/lib/supabase/browser';
import { Button, Icon, InlineError } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'pw' | 'link' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy('pw');
    const { error: err } = await getBrowserClient().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(null);
    if (err) {
      setError(err.message);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  async function magic() {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    setBusy('link');
    const { error: err } = await getBrowserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/` },
    });
    setBusy(null);
    if (err) setError(err.message);
    else setInfo('Check your email for the sign-in link.');
  }

  return (
    <main className="wrap" style={{ maxWidth: 420, paddingTop: 64 }}>
      <div className="brand" style={{ marginBottom: 20 }}>
        <span className="logo">
          <Icon name="pulse" style={{ strokeWidth: 2.4 }} />
        </span>
        Proof of Work
      </div>
      <h1 className="title">Sign in</h1>
      <p className="sub" style={{ marginBottom: 16 }}>Single-user account.</p>
      <form className="card stack" onSubmit={signIn}>
        <label className="field">
          <span className="fl">Email</span>
          <input className="plain" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="fl">Password</span>
          <input className="plain" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? <InlineError message={error} /> : null}
        {info ? (
          <div className="warnbox" role="status" style={{ background: 'var(--green-tint)', color: 'var(--green-text)' }}>
            <Icon name="check" sm />
            <span>{info}</span>
          </div>
        ) : null}
        <Button type="submit" variant="primary" loading={busy === 'pw'} disabled={!password || !email} style={{ width: '100%' }}>
          Sign in
        </Button>
        <Button variant="ghost" loading={busy === 'link'} onClick={magic} style={{ width: '100%' }}>
          Email me a magic link
        </Button>
      </form>
    </main>
  );
}
