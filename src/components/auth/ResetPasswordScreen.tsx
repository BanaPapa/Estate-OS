import React, { useState } from 'react';

interface ResetPasswordScreenProps {
  // 새 비밀번호 적용. 성공 시 상위(App)가 recovery 종료 → 화면 전환.
  onSubmit: (password: string) => Promise<void>;
  // 취소 → 로그아웃 후 로그인 화면으로
  onCancel: () => void | Promise<void>;
}

// 이메일 재설정 링크로 진입한 사용자가 새 비밀번호를 설정하는 화면.
export function ResetPasswordScreen({ onSubmit, onCancel }: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone]   = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (password !== confirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setBusy(true);
    try {
      await onSubmit(password);
      setDone(true); // App이 recovery를 끄기 전 짧게 표시될 수 있음
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
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

        <h1 className="auth-title">새 비밀번호 설정</h1>
        <p className="auth-sub">사용하실 새 비밀번호를 입력하세요.</p>

        <label className="auth-field">
          <span>새 비밀번호 <span className="auth-required">*</span></span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={busy}
          />
        </label>

        <label className="auth-field">
          <span>새 비밀번호 확인 <span className="auth-required">*</span></span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            disabled={busy}
          />
        </label>

        {error && <div className="auth-msg err">{error}</div>}
        {done  && <div className="auth-msg ok">비밀번호가 변경되었습니다. 잠시만 기다려 주세요…</div>}

        <button type="submit" className="eos-run-btn auth-submit" disabled={busy}>
          {busy ? '변경 중…' : '비밀번호 변경'}
        </button>

        <div className="auth-switch">
          <button type="button" onClick={() => onCancel()} disabled={busy}>
            취소하고 로그인으로
          </button>
        </div>
      </form>
    </div>
  );
}
