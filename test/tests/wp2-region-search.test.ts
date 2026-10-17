import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { LatLng } from '../src/types';
import {
  decodeRegionId,
  encodeRegionId,
  isInRegion,
  nearestRegionLocal,
  regionById,
  regionFromAdmin,
  searchRegionsLocal,
  shortRegionName,
} from '../src/data/regions';
import { createRegionSearch, regionsFromAddress } from '../src/services/regions';
import { checkTripForm } from '../src/core/trip/create';
import { fakeFetch } from './helpers/fakes';

/**
 * 여행방 지역 고르기(FR-201, 2026-10-10): 검색('익산')과 지도 누르기로 국내 시·군을 고른다.
 * 목록에 없는 지역은 이름·중심·반경을 id(geo:)에 담아 여행방 문서 하나로 어디서나 풀린다.
 */

const IKSAN: LatLng = { latitude: 35.9483, longitude: 126.9577 };
const API = 'http://10.0.0.5:8787';

const IKSAN_ADDRESS = {
  documents: [
    { address_name: '전북 익산시 모현동1가', address_type: 'REGION', x: '126.94', y: '35.95', address: { region_1depth_name: '전북', region_2depth_name: '익산시', region_3depth_name: '모현동1가' } },
    { address_name: '전북 익산시', address_type: 'REGION', x: String(IKSAN.longitude), y: String(IKSAN.latitude), address: { region_1depth_name: '전북', region_2depth_name: '익산시', region_3depth_name: '' } },
  ],
};

test('목록 밖 지역은 geo: id로 담기고 regionById로 그대로 풀린다. 국외 좌표·이상한 반경은 모르는 지역이다', () => {
  const id = encodeRegionId({ name: '익산', label: '전북특별자치도 익산시', center: IKSAN, radiusKm: 15 });
  assert.ok(id.startsWith('geo:'));
  const r = regionById(id);
  assert.deepEqual([r?.name, r?.label, r?.radiusKm], ['익산', '전북특별자치도 익산시', 15]);
  assert.ok(isInRegion(id, { latitude: 35.95, longitude: 126.96 }));
  assert.equal(decodeRegionId('geo:10,10,15:a:b'), undefined);
  assert.equal(decodeRegionId('geo:35.9,126.9,500:a:b'), undefined);
  assert.equal(decodeRegionId('geo:broken'), undefined);
  assert.equal(regionById('gyeongju')?.name, '경주');
});

test('행정구역 이름 → 여행 지역: 목록에 있으면 목록 지역, 없으면 시·군 geo 지역(특별·광역시는 시 전체)', () => {
  assert.equal(shortRegionName('익산시'), '익산');
  assert.equal(shortRegionName('가평군'), '가평');
  assert.equal(shortRegionName('서울특별시'), '서울');
  const iksan = regionFromAdmin('전북', '익산시', IKSAN);
  assert.deepEqual([iksan?.name, iksan?.label, iksan?.radiusKm], ['익산', '전북특별자치도 익산시', 15]);
  assert.ok(iksan?.id.startsWith('geo:'));
  assert.equal(regionFromAdmin('경북', '경주시', { latitude: 35.85, longitude: 129.22 })?.id, 'gyeongju');
  assert.equal(regionFromAdmin('서울특별시', '종로구', { latitude: 37.57, longitude: 126.98 })?.id, 'seoul');
  assert.equal(regionFromAdmin('경기', '수원시 장안구', { latitude: 37.3, longitude: 127.01 })?.id, 'suwon');
  assert.equal(regionFromAdmin('충남', '청양군', { latitude: 36.46, longitude: 126.8 })?.radiusKm, 20);
});

test('주소 검색 결과: 시·군 자체가 먼저이고 같은 시·군은 하나로 모인다', () => {
  const rs = regionsFromAddress(IKSAN_ADDRESS);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].label, '전북특별자치도 익산시');
  assert.deepEqual(rs[0].center, IKSAN);
});

test('서버 경유 검색: /kakao/local/address로 찾고, 카카오를 못 쓰면 목록 지역에서 찾는다', async () => {
  const ok = fakeFetch((c) => (c.url.includes('/kakao/local/address') ? { body: IKSAN_ADDRESS } : { status: 404, body: {} }));
  const search = createRegionSearch({ apiUrl: API, fetch: ok });
  const found = await search.search('익산');
  assert.equal(found[0]?.name, '익산');
  assert.equal(new URL(ok.calls[0].url).searchParams.get('query'), '익산');
  const down = createRegionSearch({ apiUrl: API, fetch: fakeFetch(() => ({ status: 503, body: { error: 'kakaoDisabled' } })) });
  assert.equal((await down.search('경주'))[0]?.id, 'gyeongju');
  assert.deepEqual(await down.search('익산'), [], '목록에 없으면 빈 결과');
});

test('지도 누르기: 좌표 → 행정구역으로 시·군을 찾고, 중심은 그 시·군의 주소 좌표다. 카카오가 없으면 가장 가까운 목록 지역', async () => {
  const f = fakeFetch((c) =>
    c.url.includes('/kakao/local/region')
      ? { body: { documents: [{ region_type: 'B', region_1depth_name: '전북특별자치도', region_2depth_name: '익산시', region_3depth_name: '모현동1가' }] } }
      : c.url.includes('/kakao/local/address')
        ? { body: IKSAN_ADDRESS }
        : { status: 404, body: {} },
  );
  const r = await createRegionSearch({ apiUrl: API, fetch: f }).at({ latitude: 35.95, longitude: 126.94 });
  assert.equal(r?.label, '전북특별자치도 익산시');
  assert.deepEqual(r?.center, IKSAN);
  const local = createRegionSearch({ fetch: fakeFetch() });
  assert.equal((await local.at({ latitude: 35.84, longitude: 129.21 }))?.id, 'gyeongju');
  assert.equal(nearestRegionLocal({ latitude: 38.9, longitude: 124.5 }), undefined);
  assert.ok(searchRegionsLocal('강원').some((x) => x.id === 'gangneung'));
});

test('여행방 만들기 검사: geo 지역도 유효한 지역이다', () => {
  const id = encodeRegionId({ name: '익산', label: '전북특별자치도 익산시', center: IKSAN, radiusKm: 15 });
  const check = checkTripForm({
    title: '익산 여행',
    regionId: id,
    startDate: '2026-10-20',
    endDate: '2026-10-21',
    dayStart: '09:00',
    dayEnd: '21:00',
  } as Parameters<typeof checkTripForm>[0]);
  assert.equal(check.errors.region, undefined);
  assert.equal(checkTripForm({ title: 'x', regionId: 'geo:bad', startDate: '2026-10-20', endDate: '2026-10-21', dayStart: '09:00', dayEnd: '21:00' } as Parameters<typeof checkTripForm>[0]).errors.region, '국내 지역을 골라 주세요');
});
