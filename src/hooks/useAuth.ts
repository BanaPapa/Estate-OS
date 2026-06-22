import { useState, useEffect, useCallback, useRef } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { fetchMyProfile, type Profile } from '../services/profilesRepo';

export interface AuthState {
  configured: boolean;      // Supabase 키 설정 여부
  loading: boolean;         // 초기 세션 복원 중
  session: Session | null;
  user: User | null;
  profile: Profile | null;  // 승인 상태/권한 (status, role)
  profileLoading: boolean;  // 로그인 후 프로필 조회 중
  recovery: boolean;        // 비밀번호 재설정 모드 (이메일 링크로 진입)
}

// 이메일 재설정 링크로 진입했는지 — URL 해시에 type=recovery 포함 (초기 깜빡임 방지용)
function detectRecoveryFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hash.includes('type=recovery');
}

// 이메일/비밀번호 인증 + 승인 프로필 상태. Supabase 미설정 시 모든 동작은 안전하게 no-op.
export function useAuth() {
  const [state, setState] = useState<AuthState>({
    configured: isSupabaseConfigured,
    loading: isSupabaseConfigured, // 설정된 경우에만 세션 복원 대기
    session: null,
    user: null,
    profile: null,
    profileLoading: false,
    recovery: detectRecoveryFromUrl(),
  });

  // 현재 user.id 기준으로만 프로필 적용 (경쟁 상태 방지)
  const userIdRef = useRef<string | null>(null);

  const loadProfile = useCallback(async (uid: string | null) => {
    userIdRef.current = uid;
    if (!uid) {
      setState((s) => ({ ...s, profile: null, profileLoading: false }));
      return;
    }
    // blocking 로딩 화면은 '최초 1회'(프로필 미조회)에만 표시.
    // 탭 포커스 시 Supabase 토큰 자동 갱신 → onAuthStateChange → 여기 재진입 시
    // profileLoading을 true로 올리면 App이 로딩 화면으로 전환되어 작업 화면(검색조건·결과·캐시)이
    // 통째로 언마운트/초기화된다. 이미 프로필이 있으면 백그라운드로 조용히 갱신한다.
    setState((s) => ({ ...s, profileLoading: s.profile === null }));
    try {
      const profile = await fetchMyProfile();
      if (userIdRef.current !== uid) return; // 그 사이 사용자 변경됨 → 폐기
      setState((s) => ({ ...s, profile, profileLoading: false }));
    } catch (err) {
      console.error('프로필 조회 실패:', err);
      if (userIdRef.current !== uid) return;
      // 백그라운드 갱신 실패 시 기존 프로필 유지 (일시적 네트워크 오류로 화면이 초기화되지 않도록).
      // 최초 조회 실패 시에만 null 유지 → 승인 대기 화면으로.
      setState((s) => ({ ...s, profileLoading: false }));
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user ?? null;
      setState((s) => ({ ...s, loading: false, session: data.session, user }));
      loadProfile(user?.id ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;
      // 이메일 재설정 링크로 진입 → 새 비밀번호 입력 화면으로. 일반 게이트/프로필 로드 스킵.
      if (event === 'PASSWORD_RECOVERY') {
        userIdRef.current = user?.id ?? null;
        setState((s) => ({ ...s, loading: false, session, user, recovery: true }));
        return;
      }
      setState((s) => ({ ...s, loading: false, session, user }));
      loadProfile(user?.id ?? null);
    });

    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (
    email: string,
    password: string,
    meta?: { name: string; company: string; phone: string },
  ) => {
    if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: meta ? { data: { name: meta.name, company: meta.company, phone: meta.phone } } : undefined,
    });
    if (error) throw error;
    // 이메일 확인이 켜져 있으면 session=null (확인 메일 발송됨)
    return { needsEmailConfirm: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  // 비밀번호 재설정 메일 발송. redirectTo는 현재 도메인 → 로컬/배포 자동 대응.
  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
  }, []);

  // 재설정 모드에서 새 비밀번호 적용 → recovery 종료 후 프로필 로드(일반 게이트로 전환)
  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* noop */ }
    const { data } = await supabase.auth.getUser();
    setState((s) => ({ ...s, recovery: false }));
    loadProfile(data.user?.id ?? null);
  }, [loadProfile]);

  // 재설정 화면에서 취소 → 로그아웃하고 로그인 화면으로
  const cancelRecovery = useCallback(async () => {
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* noop */ }
    setState((s) => ({ ...s, recovery: false }));
    if (supabase) await supabase.auth.signOut();
  }, []);

  // 관리자 승인 후 사용자가 새로고침 없이 상태를 갱신할 수 있도록
  const reloadProfile = useCallback(() => {
    loadProfile(userIdRef.current);
  }, [loadProfile]);

  return {
    ...state,
    signIn,
    signUp,
    signOut,
    reloadProfile,
    requestPasswordReset,
    updatePassword,
    cancelRecovery,
  };
}
