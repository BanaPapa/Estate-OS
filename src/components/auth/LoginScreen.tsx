import React, { useState } from 'react';

interface LoginScreenProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<{ needsEmailConfirm: boolean }>;
}

type Mode = 'signin' | 'signup';

// 아이디(이메일) 기억하기 — localStorage 저장 키
const REMEMBER_KEY = 'eos_remember_email';

function loadRememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveRememberedEmail(email: string, remember: boolean): void {
  try {
    if (remember && email) localStorage.setItem(REMEMBER_KEY, email);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // localStorage 비활성(시크릿 모드 등) — 무시
  }
}

export function LoginScreen({ onSignIn, onSignUp }: LoginScreenProps) {
  const remembered = loadRememberedEmail();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState(remembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(remembered));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    if (mode === 'signup' && password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await onSignIn(email.trim(), password);
        saveRememberedEmail(email.trim(), remember); // 로그인 성공 시에만 반영
      } else {
        const { needsEmailConfirm } = await onSignUp(email.trim(), password);
        if (needsEmailConfirm) {
          setNotice('확인 메일을 보냈습니다. 메일의 링크를 클릭한 뒤 로그인해주세요.');
          setMode('signin');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="eos-brand-mark" />
          <div className="auth-brand-tx">
            <b>Estate&nbsp;OS</b>
            <span>매물시세</span>
          </div>
        </div>

        <h1 className="auth-title">{mode === 'signin' ? '로그인' : '회원가입'}</h1>
        <p className="auth-sub">
          {mode === 'signin' ? '계정으로 로그인하세요.' : '이메일과 비밀번호로 계정을 만드세요.'}
        </p>

        <label className="auth-field">
          <span>이메일</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
          />
        </label>

        <label className="auth-field">
          <span>비밀번호</span>
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={busy}
          />
        </label>

        {mode === 'signin' && (
          <label className="auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={busy}
            />
            <span>아이디 기억하기</span>
          </label>
        )}

        {error && <div className="auth-msg err">{error}</div>}
        {notice && <div className="auth-msg ok">{notice}</div>}

        <button type="submit" className="eos-run-btn auth-submit" disabled={busy}>
          {busy ? '처리 중…' : mode === 'signin' ? '로그인' : '회원가입'}
        </button>

        <div className="auth-switch">
          {mode === 'signin' ? '계정이 없으신가요?' : '이미 계정이 있으신가요?'}
          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
              setError(null);
              setNotice(null);
            }}
            disabled={busy}
          >
            {mode === 'signin' ? '회원가입' : '로그인'}
          </button>
        </div>
      </form>
    </div>
  );
}
