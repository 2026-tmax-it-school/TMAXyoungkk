import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DiaryEntry, Op, OpBody, Photo, Trip, Visit } from '../src/types';
import type { DiaryWriter } from '../src/core/ports';
import {
  composeDiary,
  datesWithRecords,
  diaryBlocks,
  diaryShareText,
  diaryStaleness,
  FREE_PLACE_NAME,
  mergeRegenerated,
} from '../src/core/journal/diary';
import { applyOp, foldOps, validateOp } from '../src/core/ops';
import { atKst } from '../src/core/util';
import { createDiaryWriter } from '../src/services/diary';
import { createAiDiary } from '../src/services/diary/ai';
import { createTemplateDiary } from '../src/services/diary/template';
import { fakeFetch } from './helpers/fakes';
import { memberId, scenarioTrip } from './helpers/fixtures';

/** WP6 FR-702 자동 일기, FR-703 편집·공유 */

const D = '2026-10-18';

function visit(spot: string, hhmm: string, who = 'minji'): Visit {
  const t = atKst(D, hhmm);
  return { id: `v-${spot}-${who}`, spotId: `s-${spot}`, date: D, memberId: memberId(who as 'minji'), arrivedAt: t, status: 'arrived', source: 'sim', at: t };
}

function photo(id: string, hhmm: string, spot?: string, who = 'minji'): Photo {
  const p: Photo = {
    id,
    memberId: memberId(who as 'minji'),
    bytes: 1,
    originalBytes: 1,
    compressed: false,
    takenAt: atKst(D, hhmm),
    source: 'exif',
    uploadedAt: atKst(D, hhmm),
  };
  if (spot) p.spotId = `s-${spot}`;
  return p;
}

function tripWithRecords(): Trip {
  const t = scenarioTrip();
  t.visits = [visit('gj-seokguram', '11:07', 'junho'), visit('gj-bulguksa', '09:25'), visit('gj-bulguksa', '09:27', 'sua')];
  t.photos = [photo('p1', '09:40', 'gj-bulguksa'), photo('p2', '11:30', 'gj-seokguram', 'sua'), photo('p3', '15:10')];
  return t;
}

let opN = 0;
function op(body: OpBody, o: Partial<Op> = {}): Op {
  opN += 1;
  return { id: `op-${opN}`, tripId: 'trip-scenario', actorId: memberId('minji'), at: atKst(D, '21:00'), ...body, ...o } as Op;
}

describe('FR-702 시간순 블록', () => {
  test('사진·도착 기록·장소를 스팟 단위 시간순 블록으로 묶는다', () => {
    const drafts = diaryBlocks(tripWithRecords(), D);
    assert.deepEqual(
      drafts.map((d) => [d.block.time, d.block.placeName, d.block.photoIds]),
      [
        ['09:25', '불국사', ['p1']],
        ['11:07', '석굴암', ['p2']],
        ['15:10', FREE_PLACE_NAME, ['p3']],
      ],
    );
    assert.deepEqual(drafts[0].write.memberNames, ['민지', '수아']);
    assert.equal(drafts[0].write.category, '관광지');
    // 블록 id는 날짜+스팟이라 다시 만들어도 같다
    assert.equal(drafts[0].block.id, `${D}:s-gj-bulguksa`);
  });

  test('사진 0장이면 방문 기록만으로 만든다', async () => {
    const t = tripWithRecords();
    t.photos = [];
    const e = await composeDiary(t, D, createTemplateDiary(), 1);
    assert.equal(e.status, 'auto');
    assert.equal(e.blocks.length, 2);
    assert.ok(e.blocks.every((b) => b.photoIds.length === 0 && b.text.length > 0));
    assert.match(e.blocks[0].text, /불국사/);
  });

  test('취소·지나침 방문은 일기에 넣지 않는다', () => {
    const t = scenarioTrip();
    t.visits = [{ ...visit('gj-bulguksa', '09:25'), status: 'cancelled' }, { ...visit('gj-seokguram', '11:00'), status: 'skipped' }];
    assert.equal(diaryBlocks(t, D).length, 0);
  });

  test('작성기가 던지면 status empty인 빈 일기를 주고 죽지 않는다', async () => {
    const broken: DiaryWriter = {
      id: 'ai',
      async write() {
        throw new Error('down');
      },
    };
    const e = await composeDiary(tripWithRecords(), D, broken, 5);
    assert.equal(e.status, 'empty');
    assert.equal(e.generatedAt, 5);
    assert.ok(e.blocks.every((b) => b.text === ''));
    assert.equal(e.blocks.length, 3);
    const none = await composeDiary(scenarioTrip(), D, createTemplateDiary(), 5);
    assert.equal(none.status, 'empty');
    assert.deepEqual(none.blocks, []);
  });

  test('AI 프록시 작성기: /diary로 보내고 형식이 틀리면 던져 빈 일기가 된다', async () => {
    const ok = fakeFetch(() => ({ body: { texts: ['가', '나', '다'] } }));
    const w = createDiaryWriter({ aiProxyUrl: 'https://proxy.example/', fetch: ok });
    assert.equal(w.id, 'ai');
    const e = await composeDiary(tripWithRecords(), D, w, 1);
    assert.deepEqual(e.blocks.map((b) => b.text), ['가', '나', '다']);
    assert.equal(ok.calls[0].url, 'https://proxy.example/diary');
    assert.equal(JSON.parse(ok.calls[0].init?.body ?? '{}').blocks.length, 3);
    const bad = createAiDiary({ url: 'https://p', fetch: fakeFetch(() => ({ body: { texts: ['하나'] } })) });
    assert.equal((await composeDiary(tripWithRecords(), D, bad, 1)).status, 'empty');
    const down = createAiDiary({ url: 'https://p', fetch: fakeFetch(() => ({ status: 500 })) });
    assert.equal((await composeDiary(tripWithRecords(), D, down, 1)).status, 'empty');
    // 응답이 오지 않으면 시간 초과로 던져 빈 일기가 된다(화면이 멈추지 않는다)
    const hang = createAiDiary({ url: 'https://p', fetch: fakeFetch(() => new Promise(() => {})), timeoutMs: 20 });
    assert.equal((await composeDiary(tripWithRecords(), D, hang, 1)).status, 'empty');
    assert.equal(createDiaryWriter({ fetch: ok }).id, 'template');
  });

  test('템플릿 문장은 카테고리와 함께한 멤버, 사진 수를 담는다', async () => {
    const texts = await createTemplateDiary().write({
      date: D,
      blocks: [{ time: '09:25', placeName: '불국사', category: '관광지', photoCount: 2, memberNames: ['민지', '준호'] }],
    });
    assert.equal(texts[0], '09:25 민지, 준호와 함께 불국사에서 천천히 둘러봤다. 사진 2장을 남겼다.');
  });
});

describe('FR-703 편집·공유', () => {
  async function generated(): Promise<Trip> {
    const t = tripWithRecords();
    const entry = await composeDiary(t, D, createTemplateDiary(), atKst(D, '20:00'));
    return applyOp(t, op({ type: 'journal/diaryGenerated', entry }, { at: atKst(D, '20:00') })) as Trip;
  }

  test('diaryEdited는 op.at 나중 저장 우선이고, 순서가 뒤바뀌어 도착해도 같다', async () => {
    const t = await generated();
    const blockId = t.diaries[D].blocks[0].id;
    const early = op({ type: 'journal/diaryEdited', date: D, blockId, text: '먼저 쓴 문장' }, { at: atKst(D, '21:00'), actorId: memberId('junho') });
    const late = op({ type: 'journal/diaryEdited', date: D, blockId, text: '나중 쓴 문장' }, { at: atKst(D, '21:05') });
    const a = applyOp(applyOp(t, early), late) as Trip;
    const b = applyOp(applyOp(t, late), early) as Trip;
    assert.equal(a.diaries[D].blocks[0].text, '나중 쓴 문장');
    assert.equal(b.diaries[D].blocks[0].text, '나중 쓴 문장');
    assert.equal(a.diaries[D].blocks[0].editedBy, memberId('minji'));
    assert.equal(a.diaries[D].blocks[0].editedAt, atKst(D, '21:05'));
  });

  test('다시 만들어도 사용자가 고친 문장과 공유 시각은 남는다', async () => {
    let t = await generated();
    const blockId = t.diaries[D].blocks[1].id;
    t = applyOp(t, op({ type: 'journal/diaryEdited', date: D, blockId, text: '석굴암 최고' })) as Trip;
    t = applyOp(t, op({ type: 'journal/diaryShared', date: D }, { at: atKst(D, '21:10') })) as Trip;
    const again = await composeDiary(t, D, createTemplateDiary(), atKst(D, '22:00'));
    t = applyOp(t, op({ type: 'journal/diaryGenerated', entry: again })) as Trip;
    assert.equal(t.diaries[D].blocks[1].text, '석굴암 최고');
    assert.equal(t.diaries[D].sharedAt, atKst(D, '21:10'));
    assert.notEqual(t.diaries[D].blocks[0].text, '석굴암 최고');
  });

  test('재생성은 generatedAt 나중 저장 우선이라 순서가 뒤바뀌어 도착해도 새 쪽이 남는다', async () => {
    const t = tripWithRecords();
    const older = await composeDiary({ ...t, photos: [] }, D, createTemplateDiary(), atKst(D, '20:00'));
    const newer = await composeDiary(t, D, createTemplateDiary(), atKst(D, '21:00'));
    const a = applyOp(applyOp(t, op({ type: 'journal/diaryGenerated', entry: newer })), op({ type: 'journal/diaryGenerated', entry: older })) as Trip;
    const b = applyOp(applyOp(t, op({ type: 'journal/diaryGenerated', entry: older })), op({ type: 'journal/diaryGenerated', entry: newer })) as Trip;
    assert.equal(a.diaries[D].generatedAt, atKst(D, '21:00'));
    assert.deepEqual(a.diaries[D], b.diaries[D]);
    assert.equal(a.diaries[D].blocks.length, 3);
  });

  test('스팟 없는 사진 묶음의 첫 사진이 바뀌어도 고친 문장이 남는다', async () => {
    let t = await generated();
    const free = t.diaries[D].blocks.find((b) => !b.spotId)!;
    t = applyOp(t, op({ type: 'journal/diaryEdited', date: D, blockId: free.id, text: '내가 쓴 문장' })) as Trip;
    // 14:50에 더 이른 사진이 들어와 같은 묶음 시작이 앞당겨진다(시가 바뀐다)
    t = { ...t, photos: [...t.photos, photo('pA', '14:50')] };
    const again = await composeDiary(t, D, createTemplateDiary(), atKst(D, '22:00'));
    t = applyOp(t, op({ type: 'journal/diaryGenerated', entry: again })) as Trip;
    const block = t.diaries[D].blocks.find((b) => b.photoIds.includes('p3'))!;
    assert.deepEqual(block.photoIds, ['pA', 'p3']);
    assert.equal(block.text, '내가 쓴 문장');
  });

  test('옮길 블록이 없어진 고친 문장은 버리지 않고 남긴다', () => {
    const prev: DiaryEntry = {
      date: D,
      status: 'auto',
      generatedAt: 1,
      blocks: [{ id: 'x', time: '15:10', placeName: FREE_PLACE_NAME, photoIds: ['gone'], text: '남겨 둘 문장', editedAt: 2 }],
    };
    const next: DiaryEntry = { date: D, status: 'auto', generatedAt: 3, blocks: [{ id: 'y', time: '09:00', placeName: '불국사', photoIds: [], text: '새 문장' }] };
    const m = mergeRegenerated(prev, next);
    assert.deepEqual(m.blocks.map((b) => [b.id, b.text]), [['y', '새 문장'], ['x', '남겨 둘 문장']]);
  });

  test('문장을 모두 지우면 빈 일기가 된다', async () => {
    let t = await generated();
    for (const b of t.diaries[D].blocks) {
      t = applyOp(t, op({ type: 'journal/diaryEdited', date: D, blockId: b.id, text: '' })) as Trip;
    }
    assert.equal(t.diaries[D].status, 'empty');
  });

  test('만든 뒤 들어온 기록은 새 기록으로 센다', async () => {
    const t = await generated();
    const entry = t.diaries[D];
    assert.deepEqual(diaryStaleness(t, entry), { newRecords: 0, blankBlocks: 0 });
    const later = { ...photo('p9', '16:30'), uploadedAt: entry.generatedAt + 1 };
    const withNew = { ...t, photos: [...t.photos, later] };
    assert.equal(diaryStaleness(withNew, entry).newRecords, 1);
  });

  test('일기를 만들 수 있는 날짜는 여행 기간 안만이다', () => {
    const t = tripWithRecords();
    t.photos.push({ ...photo('old', '10:00'), takenAt: atKst('2026-10-10', '10:00') });
    assert.deepEqual(datesWithRecords(t), [D]);
  });

  test('빈 일기도 직접 문장을 쓰면 일기가 된다', async () => {
    const t = tripWithRecords();
    const entry: DiaryEntry = await composeDiary(t, D, { id: 'ai', write: async () => { throw new Error('x'); } }, 1);
    let doc = applyOp(t, op({ type: 'journal/diaryGenerated', entry })) as Trip;
    assert.equal(doc.diaries[D].status, 'empty');
    doc = applyOp(doc, op({ type: 'journal/diaryEdited', date: D, blockId: entry.blocks[0].id, text: '직접 쓴 하루' })) as Trip;
    assert.equal(doc.diaries[D].status, 'auto');
  });

  test('종료 뒤에도 일기를 만들고 고치고 공유할 수 있다(잠금 예외)', async () => {
    const t = await generated();
    const after = atKst('2026-11-01', '10:00');
    const blockId = t.diaries[D].blocks[0].id;
    for (const body of [
      { type: 'journal/diaryEdited', date: D, blockId, text: '돌아와서 고침' },
      { type: 'journal/diaryShared', date: D },
    ] as OpBody[]) {
      assert.deepEqual(validateOp(t, op(body, { at: after })), { ok: true }, body.type);
    }
    const doc = foldOps([
      { ...op({ type: 'trip/create', trip: t }, { at: 1 }), seq: 1 },
      { ...op({ type: 'journal/diaryEdited', date: D, blockId, text: '돌아와서 고침' }, { at: after }), seq: 2 },
    ]);
    assert.equal(doc?.diaries[D].blocks[0].text, '돌아와서 고침');
  });

  test('없는 문단 편집, 일기 없는 날 공유, 기간 밖 생성은 거부한다', async () => {
    const t = await generated();
    assert.equal(validateOp(t, op({ type: 'journal/diaryEdited', date: D, blockId: 'nope', text: 'x' })).ok, false);
    assert.equal(validateOp(t, op({ type: 'journal/diaryShared', date: '2026-10-17' })).ok, false);
    const out: DiaryEntry = { date: '2026-10-25', status: 'empty', blocks: [], generatedAt: 1 };
    assert.equal(validateOp(t, op({ type: 'journal/diaryGenerated', entry: out })).ok, false);
  });

  test('공유 문장에는 여행방 제목, 날짜, 블록 시각·장소·문장이 들어간다', async () => {
    const t = await generated();
    const text = diaryShareText(t, t.diaries[D]);
    assert.match(text, new RegExp(t.title));
    assert.match(text, /10\/18/);
    assert.match(text, /09:25 불국사/);
    assert.match(text, /Young Trip/);
  });

  test('나간 멤버의 사진은 일기에 그대로 남는다', async () => {
    const t = tripWithRecords();
    t.members = t.members.map((m) => (m.id === memberId('sua') ? { ...m, leftAt: 1, leftReason: 'left' } : m));
    const drafts = diaryBlocks(t, D);
    assert.ok(drafts.some((d) => d.block.photoIds.includes('p2')));
  });
});
