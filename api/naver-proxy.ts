// Vercel Serverless Function (Node) — fin.land.naver.com 프록시 (프로덕션 전용)
// 개발: Vite proxy(vite.config.ts '/naver-api')가 대신 처리.
// 경로는 vercel.json rewrite 가 __path 쿼리로 전달한다 (zero-config catch-all 미지원 우회).
import type { VercelRequest, VercelResponse } from '@vercel/node';

const NAVER_BASE = 'https://fin.land.naver.com/front-api/v1';

function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const subPath = first(req.query.__path);
    const target = new URL(`${NAVER_BASE}/${subPath}`);
    for (const [key, value] of Object.entries(req.query)) {
      if (key === '__path') continue;
      target.searchParams.set(key, first(value));
    }

    const cookie = (req.headers['x-naver-cookie'] as string | undefined) ?? '';

    const headers: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      'Referer': 'https://fin.land.naver.com/map',
      'Origin': 'https://fin.land.naver.com',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
    };
    if (cookie) headers['Cookie'] = cookie;

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
  } catch (err) {
    const e = err as { message?: string; cause?: { code?: string; message?: string; errno?: number } };
    res.status(502).json({
      proxyError: e?.message ?? String(err),
      causeCode: e?.cause?.code,
      causeMessage: e?.cause?.message,
    });
  }
}
