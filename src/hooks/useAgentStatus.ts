import { useState, useEffect, useCallback } from 'react';
import { pingAgent, getCookieStatus, startNaverLogin, AgentStatus } from '../services/agentApi';

const POLL_INTERVAL_MS = 10_000;

export function useAgentStatus() {
  const [status, setStatus] = useState<AgentStatus>('unknown');
  const [cookieReady, setCookieReady] = useState(false);
  const [bearerReady, setBearerReady] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginJustSucceeded, setLoginJustSucceeded] = useState(false);

  const check = useCallback(async () => {
    const agentSt = await pingAgent();
    setStatus(agentSt);
    if (agentSt === 'running') {
      const cs = await getCookieStatus();
      setCookieReady(cs.hasCookies);
      setBearerReady(cs.hasBearer);
    } else {
      setCookieReady(false);
      setBearerReady(false);
    }
  }, []);

  const triggerLogin = useCallback(async () => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      await startNaverLogin();
      // 낙관적 업데이트 대신 실제 상태를 에이전트에서 확인
      // (bearer 캡처 여부를 정확히 반영하기 위해)
      await check();
      setLoginJustSucceeded(true);
      setTimeout(() => setLoginJustSucceeded(false), 5000);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '로그인 중 오류가 발생했습니다.');
    } finally {
      setLoginLoading(false);
    }
  }, [check]);

  useEffect(() => {
    check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  return { status, cookieReady, bearerReady, loginLoading, loginError, loginJustSucceeded, recheck: check, triggerLogin };
}
