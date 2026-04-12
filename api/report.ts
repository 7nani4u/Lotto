// ============================================================
// Vercel 서버리스 함수: 45labs.kr 리포트 프록시
// - 브라우저에서 직접 fetch 시 CORS 차단되는 문제를 우회
// - /api/report 엔드포인트로 호출하면 45labs.kr HTML 반환
// ============================================================

export const config = { runtime: 'edge' };

const TARGET_URL = 'https://www.45labs.kr/report/1219';

export default async function handler(req: Request): Promise<Response> {
  // OPTIONS 프리플라이트 처리
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  try {
    const upstream = await fetch(TARGET_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        Referer: 'https://www.45labs.kr/',
      },
    });

    if (!upstream.ok) {
      throw new Error(`Upstream responded with HTTP ${upstream.status}`);
    }

    const html = await upstream.text();

    return new Response(JSON.stringify({ html }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: '리포트 데이터를 가져오지 못했습니다.', detail: message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  }
}

/** CORS 응답 헤더 */
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
