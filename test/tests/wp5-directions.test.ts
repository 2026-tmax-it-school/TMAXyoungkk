import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { DaySetting, LatLng } from '../src/types';
import type { Region, RouteLeg } from '../src/core/ports';
import {
  createRequestGuard,
  directionsKey,
  directionsShape,
  directionsSteps,
  endpointLabel,
  kakaoDirectionsUrl,
  mapPickEndpoint,
  MAP_PICK_NAME,
  ME_NOTICE,
  minutesText,
  modeRows,
  pickMode,
  routeReady,
  searchable,
  searchBiasFor,
  searchesAnywhere,
  searchRegionFor,
  swapEndpoints,
  tripBaseFor,
  type Endpoint,
} from '../src/core/map/directions';

/**
 * 27 자유 길찾기(2026-10-10). 지도 탭에서 아무 두 지점을 골라 도보·자동차·대중교통을 견준다.
 * 순수 규칙(core/map/directions)과 화면 소스 규칙(경로 요청 시점, 위치는 직접 고를 때만)을 본다.
 */

const A: LatLng = { latitude: 35.8347, longitude: 129.219 };
const B: LatLng = { latitude: 35.8411, longitude: 129.2335 };
const from: Endpoint = { kind: 'base', name: '라한셀렉트 경주', coord: A };
const to: Endpoint = { kind: 'spot', name: '첨성대', coord: B, id: 's1' };

const leg = (over: Partial<RouteLeg> = {}): RouteLeg => ({
  transport: 'walk',
  minutes: 20,
  meters: 1500,
  polyline: [A, { latitude: 35.838, longitude: 129.226 }, B],
  steps: [],
  estimated: false,
  ...over,
});

test('끝점 이름: 내 위치 · 기점 · 지도에서 고른 곳', () => {
  assert.equal(endpointLabel({ kind: 'me', name: 'x', coord: A }), '내 위치');
  assert.equal(endpointLabel(from), '기점 · 라한셀렉트 경주');
  assert.equal(endpointLabel(to), '첨성대');
  assert.equal(endpointLabel({ kind: 'map', name: '  ', coord: A }), MAP_PICK_NAME);
  assert.equal(endpointLabel(undefined), '');
});

test('지도 선택: 근처 장소가 있으면 그 이름, 없으면 누른 좌표 그대로', () => {
  const near = mapPickEndpoint(A, { name: '대릉원', coord: B, placeId: 'p1' });
  assert.deepEqual(near, { kind: 'place', name: '대릉원', coord: B, id: 'p1' });
  const none = mapPickEndpoint(A, null);
  assert.deepEqual(none, { kind: 'map', name: MAP_PICK_NAME, coord: A });
});

test('출발과 도착을 맞바꾼다(한쪽만 있어도)', () => {
  assert.deepEqual(swapEndpoints({ from, to }), { from: to, to: from });
  assert.deepEqual(swapEndpoints({ from }), { from: undefined, to: from });
});

test('경로 요청은 두 끝이 다 있고 떨어져 있을 때만', () => {
  assert.deepEqual(routeReady({ from }), { ready: false, reason: 'missing' });
  assert.deepEqual(routeReady({ to }), { ready: false, reason: 'missing' });
  assert.deepEqual(routeReady({ from, to: { ...to, coord: { latitude: A.latitude + 0.00005, longitude: A.longitude } } }), {
    ready: false,
    reason: 'same',
  });
  assert.deepEqual(routeReady({ from, to }), { ready: true });
  // 키는 좌표만 본다(이름만 바뀌면 다시 묻지 않는다)
  assert.equal(directionsKey({ from, to }), directionsKey({ from: { ...from, name: '다른 이름' }, to }));
  assert.notEqual(directionsKey({ from, to }), directionsKey({ from: to, to: from }));
});

test('카카오맵 링크: 이름은 인코딩하고 쉼표·빗금이 구분자와 섞이지 않는다', () => {
  const url = kakaoDirectionsUrl({ kind: 'place', name: '카페, 경주/황리단길', coord: A }, to);
  assert.equal(
    url,
    `https://map.kakao.com/link/from/${encodeURIComponent('카페, 경주/황리단길')},35.834700,129.219000/to/${encodeURIComponent('첨성대')},35.841100,129.233500`,
  );
  assert.ok(url.includes('%2C') && url.includes('%2F'));
  // 경로 부분의 쉼표는 이름 뒤 좌표 구분자 둘씩뿐이다
  const [, fromPart, toPart] = /\/from\/([^/]+)\/to\/([^/]+)$/.exec(url) ?? [];
  assert.equal(fromPart.split(',').length, 3);
  assert.equal(toPart.split(',').length, 3);
  assert.match(kakaoDirectionsUrl(from, to), /from\/%EA%B8%B0%EC%A0%90/); // '기점 · ...'
});

test('수단 줄: 자동차·대중교통·도보 순서, 응답 전·경로 없음·가장 빠름·추정 칩', () => {
  const loading = modeRows({});
  assert.deepEqual(
    loading.map((r) => [r.transport, r.state, r.timeText]),
    [
      ['car', 'loading', '찾는 중'],
      ['transit', 'loading', '찾는 중'],
      ['walk', 'loading', '찾는 중'],
    ],
  );
  const rows = modeRows({
    car: leg({ transport: 'car', minutes: 8, meters: 2400, road: 'osm' }),
    transit: leg({ transport: 'transit', minutes: 18, estimated: false, note: '대중교통 모의 모델(2차) · 실제 노선 아님' }),
    walk: null,
  });
  assert.deepEqual(rows.map((r) => r.label), ['자동차', '대중교통', '도보']);
  assert.equal(rows[0].fastest, true);
  assert.equal(rows[0].timeText, '8분');
  assert.equal(rows[0].distText, '2.4km');
  assert.equal(rows[0].estimated, false);
  assert.equal(rows[0].estimateText, undefined);
  // 대중교통은 모의 모델이라 늘 추정
  assert.equal(rows[1].estimated, true);
  assert.equal(rows[1].estimateText, '시간 추정');
  assert.equal(rows[2].state, 'none');
  assert.equal(rows[2].timeText, '경로 없음');
  assert.equal(rows[2].fastest, false);

  const est = modeRows({ walk: leg({ estimated: true }), car: leg({ transport: 'car', estimated: true, road: 'kakao' }) });
  assert.equal(est.find((r) => r.transport === 'walk')?.estimateText, '직선거리 추정');
  assert.equal(est.find((r) => r.transport === 'car')?.estimateText, '시간 추정');
});

test('고른 수단에 경로가 없으면 결과가 있는 첫 수단을 보인다', () => {
  const rows = modeRows({ car: null, transit: leg({ transport: 'transit' }), walk: leg() });
  assert.equal(pickMode(rows, 'car'), 'transit');
  assert.equal(pickMode(rows, 'walk'), 'walk');
  // 아직 응답 전이면 고른 수단 그대로
  assert.equal(pickMode(modeRows({}), 'car'), 'car');
});

test('시간 문구', () => {
  assert.equal(minutesText(0.2), '1분');
  assert.equal(minutesText(45), '45분');
  assert.equal(minutesText(60), '1시간');
  assert.equal(minutesText(95), '1시간 35분');
});

test('오래된 응답 거르기: 끝점이 바뀌면 앞 요청 응답을 버린다', () => {
  const g = createRequestGuard();
  const first = g.begin();
  assert.equal(g.isCurrent(first), true);
  const second = g.begin();
  assert.equal(g.isCurrent(first), false);
  assert.equal(g.isCurrent(second), true);
  g.cancel();
  assert.equal(g.isCurrent(second), false);
});

test('선: 실제 길이면 길 모양, 직선 추정·결과 없음이면 두 점', () => {
  const road = directionsShape(from, to, leg({ road: 'osm', estimated: true }));
  assert.equal(road.length, 3);
  assert.deepEqual(directionsShape(from, to, leg({ estimated: true })), [A, B]);
  assert.deepEqual(directionsShape(from, to, null), [A, B]);
});

test('안내 줄: steps가 없으면 방위·거리 한 줄과 도착 줄', () => {
  const s = directionsSteps(from, to, leg());
  assert.equal(s.length, 2);
  assert.match(s[0].text, /쪽으로 1\.5km 이동$/);
  assert.equal(s[1].text, '첨성대 도착');
  const given = directionsSteps(from, to, leg({ steps: [{ text: '직진', meters: 100 }] }));
  assert.deepEqual(given, [{ text: '직진', meters: 100 }]);
  assert.match(directionsSteps(from, to, null)[0].text, /이동$/);
});

test('기점: 그날 기점(승계 포함), 없으면 처음 지정된 기점', () => {
  const base = { name: '숙소', coord: A };
  const days: DaySetting[] = [
    { date: '2026-10-10', base: null, noReturn: false },
    { date: '2026-10-11', base, noReturn: false },
    { date: '2026-10-12', base: 'inherit', noReturn: false },
  ];
  assert.equal(tripBaseFor(days, '2026-10-12'), base);
  assert.equal(tripBaseFor(days, '2026-10-10'), base);
  assert.equal(tripBaseFor(days, undefined), base);
  assert.equal(tripBaseFor([{ date: '2026-10-10', base: null, noReturn: false }], '2026-10-10'), null);
});

test('검색 지역과 검색어 길이', () => {
  const regions: Region[] = [
    { id: 'seoul', name: '서울', label: '서울특별시', center: { latitude: 37.5665, longitude: 126.978 }, radiusKm: 25 },
    { id: 'gyeongju', name: '경주', label: '경상북도 경주시', center: { latitude: 35.8562, longitude: 129.2247 }, radiusKm: 30 },
  ];
  assert.equal(searchRegionFor(regions, regions[1], undefined)?.id, 'gyeongju');
  assert.equal(searchRegionFor(regions, undefined, A)?.id, 'gyeongju');
  assert.equal(searchRegionFor(regions, undefined, undefined)?.id, 'seoul');
  // 여행방 지역이 없고 반대쪽 끝도 어느 지역에도 없으면 전국에서 찾는다(서울 반경으로 거르지 않는다)
  assert.equal(searchesAnywhere(regions, undefined, undefined), true);
  assert.equal(searchesAnywhere(regions, undefined, { latitude: 33.45, longitude: 126.57 }), true);
  assert.equal(searchesAnywhere(regions, undefined, A), false);
  assert.equal(searchesAnywhere(regions, regions[1], undefined), false);
  assert.equal(searchable(' 경 '), false);
  assert.equal(searchable('경주'), true);
});

test('화면 규칙: 두 끝이 정해진 뒤에만 경로를 묻고, 위치는 내 위치를 고를 때만 읽는다', () => {
  const src = readFileSync('src/screens/DirectionsScreen.tsx', 'utf8');
  // 경로 요청은 key(두 끝이 다 있고 떨어져 있을 때만 생긴다) 효과 안에서만
  assert.match(src, /const key = ready\.ready \? directionsKey\(ends\) : undefined;/);
  assert.match(src, /if \(!key \|\| !ends\.from \|\| !ends\.to\) return;/);
  assert.equal((src.match(/routes\.route\(/g) ?? []).length, 1);
  // 응답은 최신 요청일 때만 반영한다
  assert.match(src, /if \(routeGuard\.isCurrent\(token\)\) setResults/);
  // 위치 한 번 읽기는 pickMe 안에서만 부른다
  assert.equal((src.match(/readLocationOnce\(/g) ?? []).length, 1);
  const pickMe = src.slice(src.indexOf('const pickMe = async'));
  assert.ok(pickMe.includes('readLocationOnce('), 'readLocationOnce는 pickMe 안에 있다');
  assert.ok(!/\.location\.watch\(/.test(src), '화면이 직접 위치 감시를 켜지 않는다');
  // 내 위치를 고르면 서버로 간다는 안내를 보인다
  assert.match(src, /usesMe \? <Txt v="mtTight">\{ME_NOTICE\}<\/Txt> : null/);
  // 검색은 두 글자 이상 · 잠깐 멈춘 뒤 · 엔터는 바로
  assert.match(src, /setTimeout\(\(\) => void run\(query\), SEARCH_DEBOUNCE_MS\)/);
  assert.match(src, /onSubmitEditing=/);
  // 안내 시작은 여행 진행 중일 때만
  assert.match(src, /\{liveTripId \? \(\s*<View style=\{\{ flex: 1 \}\}>\s*<Btn title="안내 시작"/);
});

test('검색 기준점: 반대쪽이 내 위치면 그 좌표를 검색 서비스로 보내지 않는다', () => {
  const region: Region = { id: 'gyeongju', name: '경주', label: '경상북도 경주시', center: { latitude: 35.8562, longitude: 129.2247 }, radiusKm: 30 };
  assert.deepEqual(searchBiasFor(undefined, region), region.center);
  assert.deepEqual(searchBiasFor({ kind: 'me', name: '내 위치', coord: A }, region), region.center);
  assert.deepEqual(searchBiasFor({ kind: 'spot', name: '첨성대', coord: A, id: 's1' }, region), A);
  assert.ok(ME_NOTICE.includes('카카오맵'), '안내 문구가 카카오맵 링크도 말한다');
});

test('화면 규칙: 늦게 온 내 위치·지도 선택 결과는 시트를 닫거나 끝점이 바뀌면 버린다', () => {
  const src = readFileSync('src/screens/DirectionsScreen.tsx', 'utf8');
  // 내 위치 읽기는 번호를 받고, 닫기(reset)가 그 번호를 무효로 한다. 결과는 번호가 살아 있을 때만 끝점으로
  const pickMe = src.slice(src.indexOf('const pickMe = async'), src.indexOf('const title ='));
  assert.match(pickMe, /if \(locBusy\) return;/);
  assert.match(pickMe, /const token = locGuard\.begin\(\);/);
  assert.ok(
    pickMe.indexOf('if (!locGuard.isCurrent(token)) return;') > pickMe.indexOf('await readLocationOnce('),
    '읽기 뒤에 번호를 확인한다',
  );
  const reset = src.slice(src.indexOf('const reset = () => {'), src.indexOf('const run = async'));
  assert.ok(reset.includes('locGuard.cancel();'), 'reset이 내 위치 읽기를 끊는다');
  // 시트가 닫히면 언제나 비운다
  assert.match(src, /if \(!visible\) reset\(\);/);
  // 고른 쪽은 시트가 넘긴다(부모의 오래된 picker 값을 쓰지 않는다)
  assert.match(src, /onPick=\{\(pickedSide, e\) => \{\s*setEnd\(pickedSide, e\);/);
  // 검색 기준점은 searchBiasFor로(내 위치 좌표를 검색 서비스로 보내지 않는다)
  assert.match(src, /places\.search\(term, region, searchBiasFor\(other, region\), \{ anywhere \}\)/);
  // 지도 선택 이름 찾기도 늦은 응답을 버린다
  const onPressMap = src.slice(src.indexOf('const onPressMap = async'), src.indexOf('const openKakao'));
  assert.match(onPressMap, /const token = mapGuard\.begin\(\);/);
  assert.match(onPressMap, /if \(!mapGuard\.isCurrent\(token\)\) return;/);
});

test('위치 한 번 읽기: 거부 · 첫 표본 하나만 받고 감시를 끈다 · 시한', async () => {
  const { readLocationOnce } = await import('../src/services/location/once');
  let stopped = 0;
  const provider = (perm: 'granted' | 'denied', emit: boolean) => ({
    id: 'sim' as const,
    permission: async () => perm,
    request: async () => perm,
    watch: (on: (s: { t: number; coord: LatLng; accuracyM: number | null }) => void) => {
      if (emit) {
        on({ t: 1, coord: A, accuracyM: 5 });
        on({ t: 2, coord: B, accuracyM: 5 });
      }
      return () => {
        stopped += 1;
      };
    },
  });
  assert.deepEqual(await readLocationOnce(provider('denied', true)), { ok: false, reason: 'denied' });
  const got = await readLocationOnce(provider('granted', true));
  assert.ok(got.ok && got.sample.coord === A, '첫 표본');
  assert.equal(stopped, 1);
  assert.deepEqual(await readLocationOnce(provider('granted', false), 10), { ok: false, reason: 'timeout' });
  assert.equal(stopped, 2);
});
