const AGENT_BASE = 'http://127.0.0.1:47328';
const HEALTH_URL = `${AGENT_BASE}/health`;

export const AGENT_NAVER_BASE = `${AGENT_BASE}/naver-api`;
export const AGENT_NAVER_NEW_BASE = `${AGENT_BASE}/naver-new-api`;

export type AgentStatus = 'unknown' | 'running' | 'offline';

export async function pingAgent(): Promise<AgentStatus> {
  try {
    const res = await fetch(HEALTH_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return 'running';
    return 'offline';
  } catch {
    return 'offline';
  }
}

// 크롤 토큰 — 메모리 캐시 (short-lived, localStorage 저장 불필요)
interface TokenCache {
  token: string;
  expiresAt: number; // ms
}

let tokenCache: TokenCache | null = null;

// 토큰 만료 60초 전에 갱신 (10분 토큰 → 9분 이내 재사용)
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export function getCachedCrawlToken(): string | null {
  if (!tokenCache) return null;
  if (Date.now() >= tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    tokenCache = null;
    return null;
  }
  return tokenCache.token;
}

export async function fetchCrawlToken(supabaseAccessToken: string): Promise<string> {
  const cached = getCachedCrawlToken();
  if (cached) return cached;

  const res = await fetch('/api/crawl-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAccessToken}`,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `crawl-token 발급 실패: ${res.status}`);
  }

  const data = (await res.json()) as { token: string; expiresIn: number };
  tokenCache = {
    token: data.token,
    expiresAt: Date.now() + data.expiresIn * 1000,
  };
  return data.token;
}

export function clearCrawlToken(): void {
  tokenCache = null;
}

// ── 네이버 로그인 상태 ──────────────────────────────────────

export interface CookieStatus {
  hasCookies: boolean;
  hasBearer: boolean;
  loginDate: string | null;
}

export async function getCookieStatus(): Promise<CookieStatus> {
  try {
    const res = await fetch(`${AGENT_BASE}/cookie-status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { hasCookies: false, hasBearer: false, loginDate: null };
    return (await res.json()) as CookieStatus;
  } catch {
    return { hasCookies: false, hasBearer: false, loginDate: null };
  }
}

// 커스텀 프로토콜로 에이전트 자동 실행 시도 (패키징된 설치본에서 동작)
export function tryLaunchAgent(): void {
  const a = document.createElement('a');
  a.href = 'estate-os-agent://launch';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); }, 200);
}

// 실제 Naver API 호출로 쿠키 유효성 검증 (오탐 방지: 오류 시 true 반환)
export async function validateConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${AGENT_BASE}/validate`, {
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return true; // agent 오류 = 불확정
    const data = (await res.json()) as { valid: boolean; inconclusive?: boolean };
    return data.valid !== false;
  } catch {
    return true; // agent 오프라인 = 불확정
  }
}

// 로그인 창을 열고 사용자가 로그인 완료할 때까지 대기 (최대 3분)
export async function startNaverLogin(): Promise<void> {
  const res = await fetch(`${AGENT_BASE}/naver-login`, {
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `로그인 요청 실패: ${res.status}`);
  }
}
