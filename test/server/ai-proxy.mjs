/**
 * AI 프록시 서버(Google Gemini). node:http만 쓴다. AI 키를 앱 번들에서 빼려고 둔다.
 * 앱은 EXPO_PUBLIC_AI_PROXY_URL로 여기에 키 없이 요청하고(src/services/aiProxy.ts),
 * 이 서버만 GEMINI_API_KEY(EXPO_PUBLIC_ 아님, 번들에 안 들어간다)로 Gemini를 부른다.
 * 키는 응답·로그·오류 메시지 어디에도 내보내지 않는다.
 *
 *   POST /extract    {text, region:{id,name}}                         → {phrases:[{phrase}]}
 *   POST /recommend  {region:{id,name}, dates, tags, existing, limit} → {items:[{place, reason}], fallback}
 *   POST /diary      {date, blocks}                                   → {texts:[문장]}(블록 수와 같게)
 *   OPTIONS *                                                         → 204(CORS 사전 요청)
 *
 * 앱 쪽 규약과 검증은 README '3. AI 프록시'와 src/services/{extraction,recommend,diary}/ai.ts다.
 * 앱은 응답을 믿지 않고 다시 거르며, 실패하면 규칙·로컬·빈 일기로 대체한다.
 * /recommend는 Gemini가 고른 장소 이름을 카카오 키워드 검색(KAKAO_REST_KEY)으로 실제 좌표에 맞춘다.
 * 카카오 키가 없으면 좌표를 믿을 수 없어 빈 목록을 돌려주고, 앱이 로컬 추천으로 대체한다.
 *
 * 환경 변수: GEMINI_API_KEY(필수), GEMINI_MODEL(기본 gemini-flash-latest), KAKAO_REST_KEY(선택),
 *   AI_PROXY_ALLOW_ORIGIN(기본 *), AI_PROXY_RATE(IP마다 분당 요청 수, 기본 30), AI_PROXY_PORT(기본 8789.
 *   server/.env의 PORT는 동기화 서버 것이라 보지 않는다)
 * 실행: npm run ai-proxy(= node --env-file-if-exists=server/.env server/ai-proxy.mjs). 키는 server/.env에 둔다
 */
import { createServer } from 'node:http';
import { isDirectRun } from './sync-server.mjs';

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const KAKAO_KEYWORD_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const MAX_BODY = 64 * 1024;
const MAX_TEXT = 8000;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('tooLarge'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 카카오 카테고리 → 앱 카테고리(src/services/places/kakao.ts mapKakaoCategory를 줄인 것) */
function categoryOf(code, name = '') {
  if (/공원|수목원|호수|산책/.test(name)) return '공원';
  if (code === 'FD6') return '식당';
  if (code === 'CE7') return '카페';
  if (code === 'AT4' || code === 'CT1' || /^\s*여행\s*>|관광|명소|문화/.test(name)) return '관광지';
  if (code === 'MT1' || code === 'CS2' || /쇼핑|시장|거리/.test(name)) return '쇼핑';
  return '기타';
}

/**
 * @param {{ apiKey: string, model?: string, kakaoKey?: string, fetch?: typeof fetch }} opts
 */
export function createAiHandlers(opts) {
  const doFetch = opts.fetch ?? fetch;
  const model = opts.model || DEFAULT_GEMINI_MODEL;

  /** Gemini에 JSON 응답을 요청한다. 실패하면 키가 없는 짧은 오류를 던진다. */
  async function gemini(prompt) {
    let res;
    try {
      res = await doFetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
        }),
      });
    } catch {
      throw new Error('gemini 네트워크 오류');
    }
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? '').join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('gemini 응답이 JSON이 아니다');
    }
  }

  async function kakaoPlace(name, regionName) {
    const q = new URLSearchParams({ query: `${regionName} ${name}`, size: '1' });
    const res = await doFetch(`${KAKAO_KEYWORD_URL}?${q}`, { headers: { Authorization: `KakaoAK ${opts.kakaoKey}` } });
    if (!res.ok) return null;
    const d = (await res.json())?.documents?.[0];
    const latitude = Number(d?.y);
    const longitude = Number(d?.x);
    if (!d?.id || !d.place_name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const place = {
      placeId: `kakao:${d.id}`,
      name: d.place_name,
      coord: { latitude, longitude },
      category: categoryOf(d.category_group_code, d.category_name),
    };
    const address = d.road_address_name || d.address_name;
    if (address) place.address = address;
    return place;
  }

  return {
    async extract(body) {
      const text = String(body?.text ?? '').slice(0, MAX_TEXT);
      const region = String(body?.region?.name ?? '');
      if (!text.trim()) return { phrases: [] };
      const out = await gemini(
        [
          `너는 여행 채팅에서 장소 이름을 뽑는다. 여행지: ${region}.`,
          '아래 채팅에서 가 볼 만한 장소(식당, 카페, 관광지, 시장, 공원 등)를 가리키는 표현을 원문 그대로 뽑아라.',
          '조사(을, 를, 에, 에서, 이, 가 등)는 빼고, 원문에 없는 글자를 만들지 마라. 장소가 아니면 넣지 마라.',
          '형식: {"phrases":[{"phrase":"원문 표현"}]}',
          '채팅:',
          text,
        ].join('\n'),
      );
      const phrases = (Array.isArray(out?.phrases) ? out.phrases : [])
        .map((p) => (typeof p === 'string' ? p : p?.phrase))
        .filter((p) => typeof p === 'string' && p.trim() && text.includes(p.trim()))
        .map((p) => ({ phrase: p.trim() }));
      return { phrases };
    },

    async recommend(body) {
      if (!opts.kakaoKey) return { items: [], fallback: false };
      const region = String(body?.region?.name ?? '');
      const limit = Math.max(1, Math.min(20, Number(body?.limit) || 10));
      const tags = Array.isArray(body?.tags) ? body.tags.map(String) : [];
      const dates = Array.isArray(body?.dates) ? body.dates.map(String) : [];
      const existing = new Set(Array.isArray(body?.existing) ? body.existing.map(String) : []);
      const out = await gemini(
        [
          `너는 국내 여행 추천가다. 여행지: ${region}. 날짜: ${dates.join(', ') || '미정'}.`,
          `여행자 성향: ${tags.join(', ') || '없음(인기 장소 위주)'}.`,
          `${region} 안에 실제로 있는 장소 ${limit + 5}곳을 추천해라. 지도에서 검색되는 정확한 상호·명칭을 써라.`,
          '이유는 한 줄로 짧게 쓴다.',
          '형식: {"items":[{"name":"장소 이름","reason":"추천 이유"}]}',
        ].join('\n'),
      );
      const picks = (Array.isArray(out?.items) ? out.items : []).filter(
        (it) => typeof it?.name === 'string' && typeof it?.reason === 'string' && it.reason.trim(),
      );
      const items = [];
      for (const it of picks) {
        if (items.length >= limit) break;
        const place = await kakaoPlace(it.name, region).catch(() => null);
        if (!place || existing.has(place.placeId) || items.some((x) => x.place.placeId === place.placeId)) continue;
        items.push({ place, reason: it.reason.split('\n')[0].trim() });
      }
      return { items, fallback: tags.length === 0 };
    },

    async diary(body) {
      const blocks = Array.isArray(body?.blocks) ? body.blocks.slice(0, 40) : [];
      if (blocks.length === 0) return { texts: [] };
      const lines = blocks.map(
        (b, i) =>
          `${i + 1}. ${b?.time ?? ''} ${b?.placeName ?? ''}(${b?.category ?? '장소'}) · 사진 ${Number(b?.photoCount) || 0}장 · 함께: ${
            Array.isArray(b?.memberNames) && b.memberNames.length ? b.memberNames.join(', ') : '혼자'
          }`,
      );
      const out = await gemini(
        [
          `너는 여행 일기를 쓴다. 날짜: ${String(body?.date ?? '')}.`,
          '아래 방문 기록마다 따뜻하고 담백한 한국어 한 문장을 써라. 기록에 없는 사실은 지어내지 마라.',
          `반드시 ${blocks.length}개 문장을 기록 순서대로 쓴다.`,
          '형식: {"texts":["문장1","문장2"]}',
          ...lines,
        ].join('\n'),
      );
      const texts = Array.isArray(out?.texts) ? out.texts : [];
      if (texts.length !== blocks.length || texts.some((t) => typeof t !== 'string')) {
        throw new Error('일기 문장 수가 맞지 않는다');
      }
      return { texts: texts.map((t) => t.trim()) };
    },
  };
}

/**
 * @param {{ port?: number, host?: string, apiKey: string, model?: string, kakaoKey?: string,
 *   allowOrigin?: string, ratePerMin?: number, fetch?: typeof fetch }} opts
 */
export function startAiProxy(opts) {
  if (!opts.apiKey) throw new Error('GEMINI_API_KEY가 없다');
  const cors = corsHeaders(opts.allowOrigin || '*');
  const rate = opts.ratePerMin ?? 30;
  const handlers = createAiHandlers(opts);
  const routes = { '/extract': handlers.extract, '/recommend': handlers.recommend, '/diary': handlers.diary };
  const hits = new Map();

  function limited(ip) {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now - h.start >= 60_000) {
      hits.set(ip, { start: now, n: 1 });
      return false;
    }
    h.n += 1;
    return h.n > rate;
  }

  const server = createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const path = new URL(req.url ?? '/', 'http://proxy').pathname.replace(/\/+$/, '');
    const handler = routes[path];
    if (req.method !== 'POST' || !handler) {
      reply(404, { error: 'notFound' });
      return;
    }
    if (limited(req.socket.remoteAddress ?? '')) {
      reply(429, { error: 'tooManyRequests' });
      return;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      reply(400, { error: 'badRequest' });
      return;
    }
    try {
      reply(200, await handler(body));
    } catch (e) {
      // 오류 메시지에는 키가 없다(gemini()가 상태 코드만 담는다). 응답에는 그것도 싣지 않는다.
      console.warn(`ai-proxy ${path} 실패: ${e instanceof Error ? e.message : 'unknown'}`);
      reply(502, { error: 'upstream' });
    }
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve({
        url: `http://${opts.host === '0.0.0.0' ? '127.0.0.1' : (opts.host ?? '127.0.0.1')}:${port}`,
        close: () => new Promise((done) => server.close(() => done(undefined))),
      });
    });
  });
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!apiKey) {
    console.error('GEMINI_API_KEY가 없다. server/.env에 넣고 npm run ai-proxy로 띄운다.');
    process.exit(1);
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  startAiProxy({
    port: Number(process.env.AI_PROXY_PORT ?? 8789),
    host: '0.0.0.0',
    apiKey,
    model,
    kakaoKey: process.env.KAKAO_REST_KEY || undefined,
    allowOrigin: process.env.AI_PROXY_ALLOW_ORIGIN,
    ratePerMin: process.env.AI_PROXY_RATE ? Number(process.env.AI_PROXY_RATE) : undefined,
  }).then(({ url }) =>
    console.log(`ai-proxy ${url} · 모델 ${model} · 추천 좌표 ${process.env.KAKAO_REST_KEY ? '카카오' : '없음(앱이 로컬 추천)'}`),
  );
}
