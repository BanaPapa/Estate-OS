import React, { useState } from 'react';

interface LoginScreenProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (
    email: string,
    password: string,
    meta: { name: string; company: string; phone: string },
  ) => Promise<{ needsEmailConfirm: boolean }>;
  onForgotPassword: (email: string) => Promise<void>;
}

type Mode = 'signin' | 'signup' | 'forgot';

const REMEMBER_KEY = 'eos_remember_email';

function loadRememberedEmail(): string {
  try { return localStorage.getItem(REMEMBER_KEY) ?? ''; } catch { return ''; }
}

function saveRememberedEmail(email: string, remember: boolean): void {
  try {
    if (remember && email) localStorage.setItem(REMEMBER_KEY, email);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch { /* 시크릿 모드 등 — 무시 */ }
}

export function LoginScreen({ onSignIn, onSignUp, onForgotPassword }: LoginScreenProps) {
  const remembered = loadRememberedEmail();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail]       = useState(remembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(remembered));
  // 회원가입 전용 추가 필드
  const [name, setName]       = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone]     = useState('');

  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // 비밀번호 찾기 — 이메일만 필요
    if (mode === 'forgot') {
      if (!email.trim()) {
        setError('가입하신 이메일을 입력해주세요.');
        return;
      }
      setBusy(true);
      try {
        await onForgotPassword(email.trim());
        setNotice('재설정 메일을 보냈습니다. 메일의 링크를 클릭해 새 비밀번호를 설정하세요.');
        setMode('signin');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }

    if (mode === 'signup') {
      if (password.length < 6) {
        setError('비밀번호는 6자 이상이어야 합니다.');
        return;
      }
      if (!name.trim()) {
        setError('이름을 입력해주세요.');
        return;
      }
      if (!company.trim()) {
        setError('회사/소속을 입력해주세요.');
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'signin') {
        await onSignIn(email.trim(), password);
        saveRememberedEmail(email.trim(), remember);
      } else {
        const { needsEmailConfirm } = await onSignUp(email.trim(), password, {
          name: name.trim(),
          company: company.trim(),
          phone: phone.trim(),
        });
        if (needsEmailConfirm) {
          setNotice('확인 메일을 보냈습니다. 메일의 링크를 클릭한 뒤 로그인해주세요.');
          switchMode('signin');
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

        <h1 className="auth-title">
          {mode === 'signin' ? '로그인' : mode === 'signup' ? '회원가입' : '비밀번호 찾기'}
        </h1>
        <p className="auth-sub">
          {mode === 'signin'
            ? '계정으로 로그인하세요.'
            : mode === 'signup'
              ? '아래 정보를 입력하고 관리자 승인을 기다리세요.'
              : '가입하신 이메일로 비밀번호 재설정 링크를 보내드립니다.'}
        </p>

        {/* ── 이메일 ── */}
        <label className="auth-field">
          <span>이메일 <span className="auth-required">*</span></span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={busy}
          />
        </label>

        {/* ── 비밀번호 (비밀번호 찾기 모드에선 숨김) ── */}
        {mode !== 'forgot' && (
          <label className="auth-field">
            <span>비밀번호 <span className="auth-required">*</span></span>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={busy}
            />
          </label>
        )}

        {/* ── 회원가입 전용 추가 필드 ── */}
        {mode === 'signup' && (
          <>
            <div className="auth-notice">
              비밀번호 분실 시 등록하신 이메일로만 재설정할 수 있습니다.
              <br />정확한 이메일 주소를 입력해주세요.
            </div>

            <label className="auth-field">
              <span>이름 <span className="auth-required">*</span></span>
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                disabled={busy}
              />
            </label>

            <label className="auth-field">
              <span>회사/소속 <span className="auth-required">*</span></span>
              <input
                type="text"
                autoComplete="organization"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="(주)에스테이트"
                disabled={busy}
              />
            </label>

            <label className="auth-field">
              <span>전화번호 <span className="auth-optional">(선택)</span></span>
              <input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                disabled={busy}
              />
            </label>
          </>
        )}

        {/* ── 아이디 기억 + 비밀번호 찾기 (로그인 전용) ── */}
        {mode === 'signin' && (
          <div className="auth-row-between">
            <label className="auth-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={busy}
              />
              <span>아이디 기억하기</span>
            </label>
            <button
              type="button"
              className="auth-link"
              onClick={() => switchMode('forgot')}
              disabled={busy}
            >
              비밀번호를 잊으셨나요?
            </button>
          </div>
        )}

        {error  && <div className="auth-msg err">{error}</div>}
        {notice && <div className="auth-msg ok">{notice}</div>}

        <button type="submit" className="eos-run-btn auth-submit" disabled={busy}>
          {busy ? '처리 중…' : mode === 'signin' ? '로그인' : mode === 'signup' ? '회원가입' : '재설정 메일 받기'}
        </button>

        <div className="auth-switch">
          {mode === 'signin' && (
            <>
              계정이 없으신가요?
              <button type="button" onClick={() => switchMode('signup')} disabled={busy}>회원가입</button>
            </>
          )}
          {mode === 'signup' && (
            <>
              이미 계정이 있으신가요?
              <button type="button" onClick={() => switchMode('signin')} disabled={busy}>로그인</button>
            </>
          )}
          {mode === 'forgot' && (
            <>
              비밀번호가 기억나셨나요?
              <button type="button" onClick={() => switchMode('signin')} disabled={busy}>로그인으로</button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
