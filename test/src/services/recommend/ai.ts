import type { Place } from '../../types';
import type { FetchLike, RecommendProvider, RecommendResult } from '../../core/ports';
import { inRegion } from '../../core/extract';
import { clampLimit, CONTEXT_NAMES_MAX, FREE_SLOTS_MAX, RECOMMEND_MIN, recommendable } from '../../core/recommend';
import { BASE_PLACE_IDS, PLACES } from '../../data/places';
import { createAiProxyClient } from '../aiProxy';

/**
 * AI 프록시 추천(WP3 소유, 순수). AI 키는 프록시 서버에만 있다.
 * 규약: POST {프록시}/recommend, 본문 {region:{id,name,center,radiusKm}, dates, tags, existing:[placeId], limit,
 * candidates:[기존 장소 이름, 30개까지], freeSlots:['M/D HH:MM-HH:MM', 10개까지]}(2026-10-17 server/ai.mjs 맥락 추가).
 * 채팅 글과 멤버 이름은 보내지 않는다.
 * 응답 {items:[{place, reason}], fallback}. 응답을 그대로 믿지 않는다. 기존 후보·지역 밖·모양이 틀린 항목을 버리고,
 * 거르는 규칙은 로컬과 같은 recommendable(중복 placeId, 기점 장소, '기타', 여행 날짜 전부 휴무)이다.
 * 결과의 source가 'ai'인지 'local'인지로 알려 준다(23이 '예시 데이터' 칩을 제공자 id가 아니라 결과 출처로 정한다).
 * 대체 규칙(2026-10-17 리뷰 반영)
 * - 호출 실패·시간 초과(15초, 서버 Gemini 마감 9초 + 카카오 4초 + 여유)·남은 곳 0이면 로컬 결과에 aiUnavailable을 세운다.
 *   23은 같은 태그의 AI 결과가 있으면 그것을 지키고, 없으면 'AI 추천을 잠시 받지 못해…'와 '다시 시도'를 보인다.
 * - 1~2곳만 남으면 버리지 않고 로컬 결과로 limit까지 채운다. AI 곳이 절반을 넘을 때만 source 'ai'다.
 * - 요청의 signal이 끊기면(새 요청이 대신하면) 로컬로 대체하지 않고 던진다(화면이 버린다).
 * - 맥락 이름(candidates)은 제공자에서 온 장소(카카오 'kakao:' 또는 장소 사전)만 보낸다. 직접 적은 장소 이름은 보내지 않는다.
 */

/** 앱이 추천 프록시 응답을 기다리는 시간(ms) */
export const AI_RECOMMEND_TIMEOUT_MS = 15_000;

const DICT_IDS: ReadonlySet<string> = new Set(PLACES.map((p) => p.placeId));

/** 제공자에서 온 장소인지(카카오 검색 결과 또는 장소 사전). 직접 적은·채팅에서 뽑은 자유 장소는 아니다 */
export function providerBacked(p: Pick<Place, 'placeId'>): boolean {
  return p.placeId.startsWith('kakao:') || DICT_IDS.has(p.placeId) || BASE_PLACE_IDS.has(p.placeId);
}
function isPlace(v: unknown): v is Place {
  const p = v as Place | null;
  return (
    !!p &&
    typeof p.placeId === 'string' &&
    typeof p.name === 'string' &&
    !!p.coord &&
    Number.isFinite(p.coord.latitude) &&
    Number.isFinite(p.coord.longitude) &&
    typeof p.category === 'string'
  );
}

/** 기존 장소 이름(제공자에서 온 장소만, 공백 정리, 중복 없이, 40자까지, 30개까지). AI 추천 맥락이다 */
export function contextNames(existing: readonly Place[]): string[] {
  const out: string[] = [];
  for (const p of existing) {
    if (!providerBacked(p)) continue;
    const n = p.name.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= CONTEXT_NAMES_MAX) break;
  }
  return out;
}

export function createAiRecommend(opts: {
  url: string;
  fetch: FetchLike;
  fallback: RecommendProvider;
  /** 기본 AI_RECOMMEND_TIMEOUT_MS. 테스트가 줄인다 */
  timeoutMs?: number;
}): RecommendProvider {
  const client = createAiProxyClient({ url: opts.url, fetch: opts.fetch });
  const timeoutMs = opts.timeoutMs ?? AI_RECOMMEND_TIMEOUT_MS;
  return {
    id: 'ai',
    async recommend(req): Promise<RecommendResult> {
      const limit = clampLimit(req.limit);
      let items: RecommendResult['items'];
      let fallbackFlag = false;
      try {
        const res = await client.call<{ items?: unknown; fallback?: unknown }>(
          '/recommend',
          {
            region: { id: req.region.id, name: req.region.name, center: req.region.center, radiusKm: req.region.radiusKm },
            dates: req.dates,
            tags: req.tags,
            existing: req.existing.map((p) => p.placeId),
            limit,
            candidates: contextNames(req.existing),
            freeSlots: (req.freeSlots ?? []).slice(0, FREE_SLOTS_MAX),
          },
          { timeoutMs, signal: req.signal },
        );
        const seen = new Set<string>();
        const ok = (p: Place) =>
          recommendable(p, {
            existing: req.existing,
            inRegion: (x) => inRegion(req.region, x),
            skipPlaceIds: BASE_PLACE_IDS,
            dates: req.dates,
            seen,
          });
        items = (Array.isArray(res?.items) ? res.items : [])
          .map((it) => it as { place?: unknown; reason?: unknown })
          .filter((it) => isPlace(it.place) && typeof it.reason === 'string' && it.reason.trim() !== '')
          .map((it) => ({ place: it.place as Place, reason: String(it.reason).split('\n')[0] }))
          .filter((it) => ok(it.place))
          .slice(0, limit);
        fallbackFlag = res?.fallback === true;
        if (items.length === 0) throw new Error('추천 결과가 없다');
      } catch (e) {
        if (req.signal?.aborted) throw e;
        return { ...(await opts.fallback.recommend(req)), source: 'local', aiUnavailable: true };
      }
      if (items.length >= RECOMMEND_MIN) return { items, fallback: fallbackFlag, source: 'ai' };
      // 1~2곳: 버리지 않고 로컬 결과로 채운다
      const local = await opts.fallback.recommend(req);
      const ids = new Set(items.map((i) => i.place.placeId));
      const names = new Set(items.map((i) => i.place.name.replace(/\s+/g, '')));
      const fill = local.items.filter((i) => !ids.has(i.place.placeId) && !names.has(i.place.name.replace(/\s+/g, '')));
      const merged = [...items, ...fill].slice(0, limit);
      const aiMajority = items.length * 2 > merged.length;
      return aiMajority
        ? { items: merged, fallback: false, source: 'ai' }
        : { items: merged, fallback: local.fallback, source: 'local' };
    },
  };
}
