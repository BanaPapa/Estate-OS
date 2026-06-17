// Vercel Serverless Function (Node) — new.land.naver.com 프록시 (프로덕션 전용)
// 개발: Vite proxy(vite.config.ts '/naver-new-api')가 대신 처리.
// 아파트 단지 목록(single-markers / cortars)과 빌라·단독 직접 매물(/api/articles)이 모두 이 도메인을 사용한다.
// 경로는 vercel.json rewrite 가 __path 쿼리로 전달한다 (zero-config catch-all 미지원 우회).
import type { VercelRequest, VercelResponse } from '@vercel/node';

const NEW_LAND_BASE = 'https://new.land.naver.com';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const reqUrl = new URL(req.url ?? '', 'http://localhost');
  const subPath = reqUrl.searchParams.get('__path') ?? '';
  reqUrl.searchParams.delete('__path');

  const target = new URL(`${NEW_LAND_BASE}/${subPath}`);
  reqUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const cookie = (req.headers['x-naver-cookie'] as string | undefined) ?? '';
  const bearer = (req.headers['x-naver-bearer'] as string | undefined) ?? '';
  const referer = (req.headers['x-naver-referer'] as string | undefined) ?? 'https://new.land.naver.com/houses';

  const headers: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'Referer': referer,
    'Origin': 'https://new.land.naver.com',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
  };
  if (cookie) headers['Cookie'] = cookie;
  // 빌라·단독 /api/articles 는 Bearer JWT 필수 (수동 토큰 — 설정 탭에서 입력)
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;

  const init: { method?: string; headers: Record<string, string>; body?: string } = {
    method: req.method,
    headers,
  };
  if (req.method === 'POST') {
    headers['Content-Type'] = 'application/json';
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  }

  const naverRes = await fetch(target.toString(), init);
  const text = await naverRes.text();

  res.status(naverRes.status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(text);
}
