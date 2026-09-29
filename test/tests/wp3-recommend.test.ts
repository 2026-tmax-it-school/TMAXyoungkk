import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Place } from '../src/types';
import type { Region } from '../src/core/ports';
import { inRegion } from '../src/core/extract';
import { closedAllDates, pickRecommendations, RECOMMEND_MAX, RECOMMEND_MIN, weekdayOf } from '../src/core/recommend';
import { BASE_PLACE_IDS, PLACES } from '../src/data/places';
import { regionById } from '../src/data/regions';
import { SCENARIO_PLACES } from '../src/data/scenario';
import { createRecommendProvider, resultSource } from '../src/services/recommend';
import { createPlaceProvider } from '../src/services/places';
import { fakeFetch } from './helpers/fakes';

/**
 * FR-404 여행지 추천(2차, WP3). 로컬 제공자: 태그 겹침 + 근접도 + 인기도, 3~5곳, 기존 후보 제외, 지역 안,
 * 태그 부족 시 인기 장소로 대체(fallback), 곳마다 추천 이유 한 줄.
 */

const region = regionById('gyeongju') as Region;
const existing: Place[] = SCENARIO_PLACES.filter((p) => p.role === 'spot').map(({ stayMin: _s, role: _r, ...p }) => p);

function provider() {
  const fetch = fakeFetch(() => ({ status: 500 }));
  return createRecommendProvider({ fetch, places: createPlaceProvider({ fetch }) });
}

async function rec(tags: string[], limit = 5, ex = existing) {
  return provider().recommend({ region, dates: ['2026-10-17', '2026-10-18', '2026-10-19'], tags, existing: ex, limit });
}

test('3~5곳, 기존 후보와 겹치지 않고 지역 안이며 기점용 장소는 빠진다', async () => {
  for (const tags of [['역사'], ['자연', '휴식'], ['맛집'], ['액티비티'], ['카페'], []]) {
    for (const limit of [1, 3, 5, 9]) {
      const r = await rec(tags, limit);
      assert.ok(r.items.length >= RECOMMEND_MIN && r.items.length <= RECOMMEND_MAX, `${tags} ${limit} → ${r.items.length}`);
      const ids = r.items.map((i) => i.place.placeId);
      assert.equal(new Set(ids).size, ids.length);
      for (const it of r.items) {
        assert.ok(!existing.some((e) => e.placeId === it.place.placeId), it.place.name);
        assert.ok(inRegion(region, it.place), `${it.place.name}은 지역 안`);
        assert.ok(!BASE_PLACE_IDS.has(it.place.placeId));
        assert.ok(it.reason.trim().length > 0 && !it.reason.includes('\n'), '추천 이유 한 줄');
      }
    }
  }
});

test('태그가 맞는 곳을 우선하고, 맞는 곳이 충분하면 대체하지 않는다', async () => {
  const r = await rec(['역사']);
  assert.equal(r.fallback, false);
  for (const it of r.items) assert.ok(it.place.tags?.includes('역사'), it.place.name);
  assert.match(r.items[0].reason, /역사 성향과 맞아요/);
});

test('태그가 없거나 부족하면 인기 장소로 대체하고 fallback을 세운다', async () => {
  const none = await rec([]);
  assert.equal(none.fallback, true);
  assert.ok(none.items.length >= RECOMMEND_MIN);
  assert.match(none.items[0].reason, /많이 찾는 곳이에요/);
  const pops = none.items.map((i) => i.place.popularity ?? 0);
  assert.deepEqual(pops, [...pops].sort((a, b) => b - a), '인기 순');
  const rare = await rec(['액티비티']);
  assert.equal(rare.fallback, true, '액티비티 태그 장소는 3곳 미만이라 대체한다');
  assert.ok(rare.items.length >= RECOMMEND_MIN);
});

test('목적지 밖 장소(호미곶)는 추천하지 않는다', async () => {
  const r = await rec(['자연'], 5, []);
  assert.ok(!r.items.some((i) => i.place.placeId === 'ph-homigot'));
});

test('pickRecommendations: 이름이 같은 기존 후보도 겹침으로 본다, 후보 풀이 모자라면 있는 만큼만', () => {
  const pool = PLACES.slice(0, 2).map(({ aliases: _a, region: _r, ...p }) => p);
  const r = pickRecommendations({ pool, tags: [], existing: [{ ...pool[0], placeId: 'other' }], limit: 5, inRegion: () => true });
  assert.deepEqual(r.items.map((i) => i.place.placeId), [pool[1].placeId]);
  assert.equal(r.fallback, true);
});

test('여행 날짜 전부가 휴무 요일인 곳은 빼고, 무게중심은 지역 안 후보로만 잡는다', () => {
  const mk = (id: string, lat: number, lng: number, more: Partial<Place> = {}): Place => ({
    placeId: id,
    name: id,
    coord: { latitude: lat, longitude: lng },
    category: '관광지',
    tags: ['역사'],
    popularity: 50,
    ...more,
  });
  // 2026-10-21은 수요일
  assert.equal(weekdayOf('2026-10-21'), 3);
  const closedWed = mk('closed', 35.83, 129.22, { hours: { open: '09:00', close: '18:00', closedWeekdays: [3] } });
  assert.equal(closedAllDates(closedWed, ['2026-10-21']), true);
  assert.equal(closedAllDates(closedWed, ['2026-10-21', '2026-10-22']), false);
  const pool = [closedWed, mk('a', 35.83, 129.22), mk('b', 35.84, 129.23), mk('c', 35.8, 129.3)];
  const r = pickRecommendations({ pool, tags: ['역사'], existing: [], limit: 5, inRegion: () => true, dates: ['2026-10-21'] });
  assert.ok(!r.items.some((i) => i.place.placeId === 'closed'));
  // 목적지 밖 후보 하나가 기준점을 끌고 가지 않는다
  const inside = mk('in', 35.83, 129.22);
  const outside = mk('out', 36.08, 129.57);
  const within = (p: Place) => inRegion(region, p);
  const withOut = pickRecommendations({ pool: pool.slice(1), tags: ['역사'], existing: [inside, outside], limit: 3, inRegion: within });
  const withoutOut = pickRecommendations({ pool: pool.slice(1), tags: ['역사'], existing: [inside], limit: 3, inRegion: within });
  assert.deepEqual(withOut.items.map((i) => i.place.placeId), withoutOut.items.map((i) => i.place.placeId));
});

test('AI 프록시 추천: placeId 중복·기점 장소·기타를 로컬과 같은 규칙으로 거르고, 로컬 대체면 출처가 local이다', async () => {
  const base = PLACES.find((p) => BASE_PLACE_IDS.has(p.placeId))!;
  const pick = (id: string) => {
    const { aliases: _a, region: _r, ...p } = PLACES.find((x) => x.placeId === id)!;
    return p;
  };
  const items = [
    { place: pick('gj-gyerim'), reason: '숲' },
    { place: pick('gj-gyerim'), reason: '중복' },
    { place: pick(base.placeId), reason: '숙소' },
    { place: { ...pick('gj-oreung'), category: '기타' }, reason: '기타' },
    { place: pick('gj-hyanggyo'), reason: '향교' },
    { place: pick('gj-poseokjeong'), reason: '포석정' },
  ];
  const fetch = fakeFetch(() => ({ body: { items, fallback: false } }));
  const rec = createRecommendProvider({ aiProxyUrl: 'https://proxy.example', fetch, places: createPlaceProvider({ fetch: fakeFetch() }) });
  const r = await rec.recommend({ region, dates: [], tags: ['역사'], existing: [], limit: 5 });
  assert.deepEqual(r.items.map((i) => i.place.placeId), ['gj-gyerim', 'gj-hyanggyo', 'gj-poseokjeong']);
  assert.equal(resultSource(r), 'ai');
  const bad = createRecommendProvider({
    aiProxyUrl: 'https://proxy.example',
    fetch: fakeFetch(() => ({ status: 500 })),
    places: createPlaceProvider({ fetch: fakeFetch() }),
  });
  assert.equal(bad.id, 'ai');
  assert.equal(resultSource(await bad.recommend({ region, dates: [], tags: [], existing: [], limit: 3 })), 'local', '대체되면 예시 데이터');
});
