import { BrowserWindow, session } from 'electron';
import { setCookie, setBearer, getBearer } from './cookieStore';

const PARTITION = 'persist:naver';
const LOGIN_URL =
  'https://nid.naver.com/nidlogin.login?mode=form&url=https%3A%2F%2Fland.naver.com%2F';

// Bearer 캡처 폴링 간격
const BEARER_POLL_MS = 300;
// Bearer 캡처 최대 대기 시간 (10초) — new.land 콜드 로드 대비
const BEARER_MAX_WAIT_MS = 10_000;
// 전체 최대 대기 시간 (3분)
const MAX_WAIT_MS = 3 * 60 * 1000;

export async function openNaverLoginWindow(): Promise<void> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 480,
      height: 750,
      title: 'Estate-OS — 네이버 로그인',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: PARTITION,
      },
      autoHideMenuBar: true,
      resizable: false,
    });

    const ses = session.fromPartition(PARTITION);
    let loginDetected = false;
    let visitedLoginPage = false;

    // new.land API 요청에서 Authorization 헤더 인터셉트 → Bearer 캡처
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['https://new.land.naver.com/*'] },
      (details, callback) => {
        const auth =
          (details.requestHeaders['Authorization'] as string | undefined) ??
          (details.requestHeaders['authorization'] as string | undefined);
        if (auth?.startsWith('Bearer ')) {
          setBearer(auth.slice(7));
        }
        callback({ requestHeaders: details.requestHeaders });
      },
    );

    const finishLogin = async (): Promise<void> => {
      if (loginDetected) return;
      loginDetected = true;
      clearTimeout(maxTimer);

      // 쿠키 캡처
      const cookies = await ses.cookies.get({ domain: '.naver.com' });
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      setCookie(cookieStr);

      // new.land로 이동해 Bearer 토큰 유발 (onBeforeSendHeaders 인터셉터가 캡처)
      if (!win.isDestroyed()) {
        win.loadURL('https://new.land.naver.com/houses');
      }

      // Bearer가 실제로 캡처될 때까지 폴링 — 고정 타임아웃 2초 대신 최대 10초 대기
      // new.land 페이지가 콜드 로드일 때 API 호출이 2초를 넘는 경우가 있어서
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(bearerPoll);
        clearTimeout(bearerTimeout);
        if (!win.isDestroyed()) win.close();
        resolve();
      };

      const bearerPoll = setInterval(() => {
        if (getBearer()) finish();
      }, BEARER_POLL_MS);

      const bearerTimeout = setTimeout(finish, BEARER_MAX_WAIT_MS);
    };

    // 로그인 감지: nid.naver.com → 다른 곳으로 이동 = 로그인 완료
    win.webContents.on('did-navigate', (_event, url) => {
      if (loginDetected) return;

      if (url.includes('nid.naver.com')) {
        visitedLoginPage = true;
        return;
      }

      // 로그인 페이지를 방문한 후 다른 도메인으로 이동 = 성공
      if (visitedLoginPage) {
        void finishLogin();
      }
    });

    win.on('closed', () => {
      clearTimeout(maxTimer);
      if (!loginDetected) {
        reject(new Error('로그인 창이 닫혔습니다. 로그인을 완료한 뒤 다시 시도해 주세요.'));
      }
    });

    // 최대 3분 타임아웃
    const maxTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.close();
      if (!loginDetected) {
        reject(new Error('로그인 시간이 초과되었습니다 (3분). 다시 시도해 주세요.'));
      }
    }, MAX_WAIT_MS);

    win.loadURL(LOGIN_URL);
  });
}
