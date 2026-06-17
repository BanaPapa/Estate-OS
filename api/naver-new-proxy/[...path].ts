// Vercel Edge Function — new.land.naver.com API 프록시 (프로덕션 전용)
// 개발: Vite proxy(vite.config.ts '/naver-new-api')가 대신 처리.
// 아파트 단지 목록(single-markers / cortars)과 빌라·단독 직접 매물(/api/articles)이 모두 이 도메인을 사용한다.
export const config = { runtime: 'edge' };

const NEW_LAND_BASE = 'https://new.land.naver.com';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // /api/naver-new-proxy/api/articles → api/articles
  const subPath = url.pathname.replace(/^\/api\/naver-new-proxy\//, '');

  const target = new URL(`${NEW_LAND_BASE}/${subPath}`);
  url.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  const cookie = req.headers.get('x-naver-cookie') ?? '';
  const bearer = req.headers.get('x-naver-bearer') ?? '';
  const referer = req.headers.get('x-naver-referer') ?? 'https://new.land.naver.com/houses';

  const headers = new Headers({
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Referer': referer,
    'Origin': 'https://new.land.naver.com',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
  });

  if (cookie) headers.set('Cookie', cookie);
  // 빌라·단독 /api/articles 는 Bearer JWT 필수. (수동 토큰 — 설정 탭에서 입력)
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`);

  const fetchInit: RequestInit = { method: req.method, headers };
  if (req.method === 'POST') {
    headers.set('Content-Type', 'application/json');
    fetchInit.body = await req.text();
  }

  const res = await fetch(target.toString(), fetchInit);
  const body = await res.text();

  return new Response(body, {
    status: res.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
