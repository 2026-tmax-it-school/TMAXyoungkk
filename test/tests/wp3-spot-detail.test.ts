import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Member, Plan, Spot, Trip } from '../src/types';
import { TRANSPORT_LABEL } from '../src/core/constants';
import { spotFromPlace } from '../src/core/extract/spot';
import { PLACES } from '../src/data/places';
import { detailRows, footActions, spotDetail } from '../src/features/candidates/detail';
import { read, stripComments } from './setup/scan';

/**
 * 07 스팟 상세(FR-803, WP3). 아래 버튼(footActions)과 정보 목록(detailRows)은 순수 함수로 정하고 화면은 그대로 그린다.
 */

const place = (id: string) => PLACES.find((p) => p.placeId === id)!;

function trip(spots: Spot[]): Trip {
  const members: Member[] = [
    { id: 'm-a', userId: 'u-a', nickname: 'A', role: 'host', isGuest: true, canInvite: false, joinedAt: 0 },
  ];
  return {
    id: 't',
    title: '경주',
    region: 'gyeongju',
    startDate: '2026-10-17',
    endDate: '2026-10-19',
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: [],
    legs: [],
    members,
    spots,
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: 0,
    createdBy: 'u-a',
    lastSeq: 0,
  };
}

function spot(id: string, placeId: string, extra: Partial<Spot> = {}): Spot {
  const s = spotFromPlace(place(placeId), {
    id,
    proposal: { memberId: 'm-a', source: 'manual', at: 1 },
    createdAt: 1,
  });
  return { ...s, ...extra };
}

const item = (spotId: string, arrive: string) => ({
  spotId,
  name: spotId,
  travelMin: 10,
  legTransport: 'car' as const,
  legEstimated: false,
  arrive,
  depart: arrive,
  stayMin: 90,
  pinned: false,
  proposerCount: 1,
  manual: false,
  notices: [],
});

const plan = {
  tripId: 't',
  days: [
    {
      date: '2026-10-18',
      base: { name: '숙소', coord: { latitude: 35.8, longitude: 129.2 } },
      baseSource: 'set',
      items: [item('s1', '09:25'), item('s2', '12:57')],
    },
  ],
  excluded: [{ spotId: 's3', name: '감은사지 삼층석탑', reasonCode: 'tooFar', reason: '왕복 1시간 10분', proposerCount: 1 }],
  overCapacity: [],
} as unknown as Plan;

test('footActions: 제외면 고정해서 다시 넣기 하나, 배치됨·고정 안 됨이면 시간표에서 보기와 고정하기, 고정됨이면 고정 풀기', () => {
  const titles = (xs: { title: string }[]) => xs.map((x) => x.title);

  const excluded = footActions({ status: 'excluded', pinned: false }, false);
  assert.deepEqual(excluded, [{ key: 'restore', title: '고정해서 다시 넣기', variant: 'primary' }]);
  // 제외 스팟은 고정·배치 여부와 상관없이 되돌리기 하나뿐이다
  assert.deepEqual(titles(footActions({ status: 'excluded', pinned: true }, true)), ['고정해서 다시 넣기']);

  const placed = footActions({ status: 'confirmed', pinned: false }, true);
  assert.deepEqual(titles(placed), ['시간표에서 보기', '고정하기']);
  assert.deepEqual(placed.map((a) => a.variant), ['quiet', 'primary']);

  const pinned = footActions({ status: 'confirmed', pinned: true }, true);
  assert.deepEqual(titles(pinned), ['시간표에서 보기', '고정 풀기']);
  assert.ok(pinned.every((a) => a.variant === 'quiet'), '고정 풀기는 주 버튼이 아니다');

  // 배치 전이면 '시간표에서 보기'가 없다
  assert.deepEqual(titles(footActions({ status: 'pending', pinned: false }, false)), ['고정하기']);
  assert.deepEqual(titles(footActions({ status: 'pending', pinned: true }, false)), ['고정 풀기']);

  // 주 버튼은 언제나 많아야 하나다
  for (const status of ['confirmed', 'pending', 'excluded'] as const) {
    for (const p of [true, false]) {
      for (const at of [true, false]) {
        assert.ok(footActions({ status, pinned: p }, at).filter((a) => a.variant === 'primary').length <= 1, `${status}/${p}/${at}`);
      }
    }
  }
});

test('detailRows: 체류와 날짜는 늘 있고 눌러서 바꾼다. 이동과 배치 시각은 있을 때만, 읽기 전용이다', () => {
  const s2 = spot('s2', 'gj-seokguram');
  const d = trip([spot('s1', 'gj-bulguksa'), s2]);
  const detail = spotDetail(d, plan, s2, 12.4);
  const rows = detailRows(detail);
  assert.deepEqual(
    rows.map((r) => [r.key, r.label, r.value, r.editable]),
    [
      ['stay', '기본 체류', `${s2.stayMin}분`, true],
      ['date', '날짜', '자동 배분 · 10/18 일', true],
      ['move', '기점에서', `${TRANSPORT_LABEL.car} 12분`, false],
      ['arrive', '배치 시각', '12:57', false],
    ],
  );
  // editable은 체류와 날짜만 true다
  assert.deepEqual(rows.filter((r) => r.editable).map((r) => r.key), ['stay', 'date']);

  // 사용자가 바꾼 체류와 지정한 날짜
  const edited = spot('s2', 'gj-seokguram', { stayMin: 120, edited: { stayMin: 5 }, fixedDate: '2026-10-19' });
  const er = detailRows(spotDetail(trip([edited]), plan, edited, 12));
  assert.deepEqual(er.slice(0, 2).map((r) => [r.label, r.value]), [
    ['체류', '120분'],
    ['날짜', '10/19 월 지정'],
  ]);

  // 제외 스팟·계획 전: 이동과 배치 시각 줄은 만들지 않는다
  const s3 = spot('s3', 'gj-gameunsaji');
  const ex = spotDetail(trip([s3]), plan, s3);
  assert.equal(ex.status, 'excluded');
  assert.deepEqual(detailRows(ex).map((r) => [r.key, r.value]), [
    ['stay', `${s3.stayMin}분`],
    ['date', '자동 배분'],
  ]);
  assert.deepEqual(footActions(ex, !!ex.item).map((a) => a.key), ['restore']);
  const pend = spot('s9', 'gj-gyerim');
  const pd = spotDetail(trip([pend]), undefined, pend);
  assert.equal(pd.status, 'pending');
  assert.deepEqual(detailRows(pd).map((r) => r.key), ['stay', 'date']);
});

test('07 화면: 머리말 버튼 없이 아래 버튼은 footActions, 정보는 detailRows, 관리 구역과 지우기 확인, useBack과 NotFound', () => {
  const src = stripComments(read('src/screens/SpotDetailScreen.tsx'));
  assert.doesNotMatch(src, /IconBtn/, '헤더 오른쪽 아이콘 버튼을 두지 않는다');
  assert.doesNotMatch(src, /right=\{/);
  assert.match(src, /footActions\(detail, !!detail\.item\)/);
  assert.match(src, /detailRows\(detail\)/);
  assert.match(src, /<Foot>[\s\S]*actions\.map/);
  // 체류 예고 문장은 체류 시트 안 안내다
  assert.match(src, /<Sheet visible=\{sheet === 'stay'\}[\s\S]*?<Notice[^>]*text=\{preview\}[\s\S]*?<\/Sheet>/);
  // '여기까지 길찾기'는 정보 아래 작은 quiet 버튼
  assert.match(src, /title="여기까지 길찾기"\s+size="sm"\s+variant="quiet"/);
  // 관리 구역: 직접 빼기(바로, 토스트), 후보에서 지우기(확인 시트 뒤 토스트와 뒤로)
  assert.match(src, /<Txt v="eyebrow">관리<\/Txt>/);
  assert.match(src, /label="직접 빼기"/);
  assert.match(src, /type: 'spot\/remove'[\s\S]*?toast\(/);
  assert.match(src, /<ConfirmSheet[\s\S]*?type: 'spot\/delete'[\s\S]*?toast\([\s\S]*?back\(\)/);
  assert.match(src, /useBack\('Schedule'\)/);
  assert.match(src, /<NotFound /);
  assert.doesNotMatch(src, /canGoBack/);
});
