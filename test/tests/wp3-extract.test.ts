import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Member, Trip } from '../src/types';
import type { Region } from '../src/core/ports';
import { extractForMessage, matchPhrase } from '../src/core/extract';
import { anchorPhrases, findPlacePhrases, stripTail } from '../src/core/extract/text';
import { regionById } from '../src/data/regions';
import { PLACES, surfacesOf } from '../src/data/places';
import { createExtractionProvider } from '../src/services/extraction';
import { createPlaceProvider } from '../src/services/places';
import { fakeFetch, fakePlaces, seqIds } from './helpers/fakes';

/**
 * FR-401 채팅 장소 추출(WP3). 규칙 기반 추출 + 로컬 장소 사전으로 돈다(네트워크 없음).
 */

const region = regionById('gyeongju') as Region;
const surfaces = PLACES.flatMap(surfacesOf);

function trip(): Trip {
  const members: Member[] = ['a', 'b'].map((k, i) => ({
    id: `m-${k}`,
    userId: `u-${k}`,
    nickname: k,
    role: i === 0 ? 'host' : 'member',
    isGuest: true,
    canInvite: false,
    joinedAt: 0,
  }));
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
    spots: [],
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: 0,
    createdBy: 'u-a',
    lastSeq: 0,
  };
}

function deps() {
  const fetch = fakeFetch(() => ({ status: 500 }));
  return {
    extraction: createExtractionProvider({ fetch }),
    places: createPlaceProvider({ fetch }),
    region,
    ids: seqIds(),
    at: 1_000,
  };
}

async function extract(text: string, t = trip()) {
  return extractForMessage(t, { id: 'msg', text, memberId: 'm-a' }, deps());
}

const names = (r: Awaited<ReturnType<typeof extract>>) => r.created.map((s) => s.name);

test("'동궁과 월지 야경 유명하대', '안압지 가자', '동궁 야경'은 모두 동궁과 월지다", async () => {
  for (const text of ['동궁과 월지 야경 유명하대', '안압지 가자', '동궁 야경', '동궁과월지 가볼래?']) {
    const r = await extract(text);
    assert.deepEqual(names(r), ['동궁과 월지'], text);
    assert.equal(r.created[0].placeId, 'gj-donggung', text);
  }
});

test("조사가 붙은 '교촌마을을'의 phrase는 원문 부분 문자열이고 조사를 넣지 않는다", async () => {
  const text = '내일은 교촌마을을 한 바퀴 돌자';
  const ph = findPlacePhrases(text, surfaces);
  assert.deepEqual(ph.map((p) => p.phrase), ['교촌마을']);
  assert.equal(text.slice(ph[0].start, ph[0].end), '교촌마을');
  const r = await extract(text);
  assert.equal(r.highlights.length, 1);
  assert.equal(text.slice(r.highlights[0].start, r.highlights[0].end), '교촌마을');
  // '교촌마을 한정식'은 더 긴 이름이 이긴다
  const r2 = await extract('교촌마을 한정식 예약했어');
  assert.deepEqual(names(r2), ['교촌마을 한정식']);
});

test('조사·어미 결합형도 원문 부분 문자열로 잡는다', async () => {
  const cases: [string, string[]][] = [
    ['불국사랑 석굴암 둘 다 가자', ['불국사', '석굴암']],
    ['첨성대에서 사진 찍자', ['첨성대']],
    ['대릉원이랑 첨성대도 보고 싶어', ['대릉원', '첨성대']],
    ['보문호까지 걸어갈 수 있나', ['보문호']],
  ];
  for (const [text, want] of cases) {
    const ph = findPlacePhrases(text, surfaces);
    assert.deepEqual(ph.map((p) => p.phrase), want, text);
    for (const p of ph) assert.equal(text.slice(p.start, p.end), p.phrase);
  }
});

test("'거기 그 카페' 같은 지시 표현은 0건이다", async () => {
  for (const text of ['거기 그 카페 다시 가자', '그 식당 이름이 뭐였지', '저 카페 괜찮던데', '여기 근처 카페 아무데나']) {
    const r = await extract(text);
    assert.equal(r.created.length + r.ambiguous.length + r.highlights.length, 0, text);
  }
});

test('인식 실패면 후보도 안내도 없다(빈 결과)', async () => {
  for (const text of ['오늘 날씨 좋다', '몇 시에 만날까?', '없는절사 가자', '']) {
    const r = await extract(text);
    assert.deepEqual(r, { created: [], mergedSpotIds: [], ambiguous: [], highlights: [] }, text);
  }
});

test('동명 다수면 자동 등록하지 않고 ambiguous로 돌려준다(황남빵 2곳)', async () => {
  const r = await extract('황남빵 사가자');
  assert.equal(r.created.length, 0);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].phrase, '황남빵');
  assert.deepEqual(r.ambiguous[0].options.map((o) => o.placeId).sort(), ['gj-hwangnam-bread-a', 'gj-hwangnam-bread-b']);
  // 말풍선 강조는 한다
  assert.equal(r.highlights.length, 1);
});

test('목적지 반경 밖 장소는 버린다(포항 호미곶)', async () => {
  const r = await extract('호미곶 일출 보러 가자');
  assert.equal(r.created.length, 0);
  assert.equal(r.highlights.length, 0);
});

test('이미 후보인 장소는 새로 만들지 않고 mergedSpotIds로 돌려준다', async () => {
  const t = trip();
  const first = await extract('불국사 가자', t);
  const t2 = { ...t, spots: first.created };
  const r = await extract('불국사 좋아. 석굴암도', t2);
  assert.deepEqual(r.mergedSpotIds, [first.created[0].id]);
  assert.deepEqual(names(r), ['석굴암']);
});

test('한 메시지의 새 후보 createdAt은 at + 등장 순서다', async () => {
  const r = await extract('불국사 갔다가 석굴암 올라가자');
  assert.deepEqual(
    r.created.map((s) => [s.name, s.createdAt]),
    [
      ['불국사', 1_000],
      ['석굴암', 1_001],
    ],
  );
  assert.equal(r.created[0].sourceText, '불국사 갔다가 석굴암 올라가자');
  assert.equal(r.created[0].proposals[0].source, 'chat');
});

test('제공자가 던지면 결과 없음으로 끝난다', async () => {
  const d = deps();
  const r = await extractForMessage(
    trip(),
    { id: 'm', text: '불국사 가자', memberId: 'm-a' },
    {
      ...d,
      places: {
        ...fakePlaces([]),
        search: async () => {
          throw new Error('down');
        },
      },
    },
  );
  assert.equal(r.created.length, 0);
});

test('matchPhrase: 관련 없는 결과는 버리고, 결과가 하나면 제공자의 별칭 판단을 믿는다', () => {
  const p = PLACES.find((x) => x.placeId === 'gj-donggung')!;
  const far = PLACES.find((x) => x.placeId === 'ph-homigot')!;
  assert.equal(matchPhrase('안압지', [p], region).kind, 'one');
  assert.equal(matchPhrase('호미곶', [far], region).kind, 'none');
  const q = PLACES.find((x) => x.placeId === 'gj-bulguksa')!;
  assert.equal(matchPhrase('안압지', [p, q], region).kind, 'none');
});

test('stripTail과 anchorPhrases: AI 결과를 원문 부분 문자열로 바로잡는다', () => {
  assert.equal(stripTail('교촌마을을'), '교촌마을');
  assert.equal(stripTail('양동마을'), '양동마을');
  const text = '교촌마을을 걷고 불국사 가자';
  const out = anchorPhrases(text, [{ phrase: '교촌마을을' }, { phrase: '없는곳' }, { phrase: '불국사', start: 99 }]);
  assert.deepEqual(out.map((o) => [o.phrase, o.start]), [
    ['교촌마을', 0],
    ['불국사', 9],
  ]);
});

test('기점 장소(숙소·역)는 채팅에서 말해도 후보가 되지 않는다', async () => {
  for (const text of ['라한호텔 체크인 먼저 하자', '신경주역에서 만나자', '라한셀렉트 로비에서 보자']) {
    const r = await extract(text);
    assert.equal(r.created.length + r.ambiguous.length + r.mergedSpotIds.length, 0, text);
  }
  // 같은 메시지의 관광지는 그대로 잡는다
  assert.deepEqual(names(await extract('라한호텔 체크인하고 보문호 산책하자')), ['보문호']);
  // 여행방 날짜별 기점으로 지정한 장소도 뺀다
  const t = trip();
  const gyerim = PLACES.find((p) => p.placeId === 'gj-gyerim')!;
  t.days = [{ date: '2026-10-17', base: { name: gyerim.name, coord: gyerim.coord, placeId: gyerim.placeId }, noReturn: false }];
  assert.equal((await extract('계림 숲길 걷자', t)).created.length, 0);
});

test("카카오 결과의 '기타'(주차장 등)는 자동 추출 후보에서 뺀다", async () => {
  const d = deps();
  const lot = { placeId: 'kakao:1', name: '안압지 주차장', coord: region.center, category: '기타' as const };
  const r = await extractForMessage(trip(), { id: 'm', text: '안압지 가자', memberId: 'm-a' }, { ...d, places: fakePlaces([lot]) });
  assert.equal(r.created.length, 0);
});

test("두 글자 별칭 뒤 동사 어미와 겹치는 한 글자는 조사로 보지 않는다('월지나', '월지만')", async () => {
  for (const text of ['월지나 가볼까', '월지만 보고 싶다고?']) {
    assert.deepEqual(findPlacePhrases(text, surfaces), [], text);
  }
  // 두 글자 별칭 + 흔한 조사는 그대로 잡는다
  for (const text of ['월지에 가자', '동궁은 밤이 예뻐', '오릉 들르자']) {
    assert.equal(findPlacePhrases(text, surfaces).length, 1, text);
  }
});

test("AI 결과 맞추기는 이름 끝과 겹치는 한 글자(도·로·만)를 떼지 않는다('울릉도', '첨성로', '영일만')", () => {
  const text = '울릉도 말고 첨성로 걷고 영일만 가자';
  const out = anchorPhrases(text, [{ phrase: '울릉도' }, { phrase: '첨성로' }, { phrase: '영일만' }]);
  assert.deepEqual(out.map((o) => o.phrase), ['울릉도', '첨성로', '영일만']);
  // 두 글자 이상 조사와 목적격 조사는 뗀다
  assert.deepEqual(anchorPhrases('불국사에서 보자', [{ phrase: '불국사에서' }]).map((o) => o.phrase), ['불국사']);
  assert.deepEqual(anchorPhrases('석굴암을 보자', [{ phrase: '석굴암을' }]).map((o) => o.phrase), ['석굴암']);
});
