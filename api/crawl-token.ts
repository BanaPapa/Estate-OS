// Vercel Serverless Function — 승인된 사용자에게 단기 크롤 토큰 발급
// 에이전트가 네이버 프록시 요청 시 X-Crawl-Token 헤더로 이 토큰을 전달한다.
// 실제 발급 로직은 api/_crawlTokenCore.ts(로컬 Vite 미들웨어와 공용)에 있다.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { issueCrawlToken } from './_crawlTokenCore';

// 서명/검증 헬퍼 재노출 (다른 서버리스 함수에서 import해 쓸 수 있도록)
export { signToken, buildCrawlToken, verifyCrawlToken } from './_crawlTokenCore';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Supabase access token 추출
  const auth = req.headers.authorization ?? '';
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  const { status, body } = await issueCrawlToken(accessToken, {
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabaseKey: process.env.VITE_SUPABASE_ANON_KEY,
    secret: process.env.CRAWL_TOKEN_SECRET,
  });

  res.status(status).json(body);
}
