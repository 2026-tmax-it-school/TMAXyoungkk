import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Op, OpBody, Photo, Plan, Trip } from '../src/types';
import type { PickedPhoto } from '../src/core/ports';
import { PHOTO_MAX_BYTES } from '../src/core/constants';
import { parseDegrees, parseExif, parseExifDate } from '../src/core/journal/exif';
import {
  buildPhoto,
  compressionFor,
  formatBytes,
  isDateAssigned,
  isForbiddenUri,
  isPlaceEstimated,
  photosOutsideTrip,
  spotAt,
  stillOverLimit,
} from '../src/core/journal/photo';
import { diaryBlocks, DATED_PLACE_NAME } from '../src/core/journal/diary';
import { buildDayTrack } from '../src/core/journal/track';
import { applyOp, validateOp } from '../src/core/ops';
import { atKst, kstDate } from '../src/core/util';
import { createSimPhotoProvider } from '../src/services/photos/sim';
import { fixedClock } from './helpers/fakes';
import { fixturePlan1018, memberId, scenarioTrip } from './helpers/fixtures';

/** WP6 FR-701 사진 업로드, 사진 저장 규칙, 모의 사진, journal/photoRemoved */

const BULGUKSA = { latitude: 35.7901, longitude: 129.332 };

function plan(trip: Trip): Plan {
  return {
    tripId: trip.id,
    days: [fixturePlan1018()],
    excluded: [],
    overCapacity: [],
    computedAt: 0,
    routeCalls: 0,
    cacheHits: 0,
    estimated: false,
    steps: [],
  };
}

let opN = 0;
function op(body: OpBody, o: Partial<Op> = {}): Op {
  opN += 1;
  return { id: `op-${opN}`, tripId: 'trip-scenario', actorId: memberId('minji'), at: atKst('2026-10-18', '12:00'), ...body, ...o } as Op;
}

function picked(o: Partial<PickedPhoto> = {}): PickedPhoto {
  return { uri: 'file:///photos/1.jpg', bytes: 2_000_000, width: 100, height: 100, ...o };
}

const ctx = (trip: Trip, now: number) => ({ id: 'ph-1', memberId: memberId('minji'), now, trip, plan: plan(trip) });

describe('FR-701 EXIF와 추정', () => {
  test('EXIF가 있으면 촬영 시각과 위치를 그대로 쓰고, 위치로 스팟을 고른다', () => {
    const trip = scenarioTrip();
    const takenAt = atKst('2026-10-18', '09:40');
    const now = atKst('2026-10-18', '20:00');
    const { photo } = buildPhoto(picked({ exif: { takenAt, coord: BULGUKSA } }), ctx(trip, now));
    assert.equal(photo.source, 'exif');
    assert.equal(photo.takenAt, takenAt);
    assert.deepEqual(photo.coord, BULGUKSA);
    assert.equal(photo.spotId, 's-gj-bulguksa');
    assert.equal(photo.uploadedAt, now);
  });

  test('EXIF가 없으면 업로드 시각과 그 시각 계획 스팟으로 추정한다', () => {
    const trip = scenarioTrip();
    const now = atKst('2026-10-18', '11:30'); // 석굴암 11:07–12:37
    const { photo } = buildPhoto(picked(), ctx(trip, now));
    assert.equal(photo.source, 'estimated');
    assert.equal(photo.takenAt, now);
    assert.equal(photo.spotId, 's-gj-seokguram');
    // coord는 EXIF GPS에만 둔다. 추정 스팟 좌표를 넣지 않는다.
    assert.equal(photo.coord, undefined);
  });

  test('EXIF에 시각만 있고 GPS가 없으면 스팟은 시각으로 추정하되 coord는 비우고 실제 경로 점이 아니다', () => {
    const trip = scenarioTrip();
    const takenAt = atKst('2026-10-18', '11:30');
    const { photo } = buildPhoto(picked({ exif: { takenAt } }), ctx(trip, atKst('2026-10-18', '20:00')));
    assert.equal(photo.source, 'exif');
    assert.equal(photo.spotId, 's-gj-seokguram');
    assert.equal(photo.coord, undefined);
    assert.equal(isPlaceEstimated(photo), true);
    trip.photos = [photo];
    assert.deepEqual(buildDayTrack(trip, plan(trip), '2026-10-18', []).marks, []);
  });

  test('여행이 끝난 뒤 EXIF 없이 올리면 고른 날짜(없으면 마지막 날)로 넣고 스팟은 추정하지 않는다', () => {
    const trip = scenarioTrip();
    const now = atKst('2026-10-22', '14:05');
    const last = buildPhoto(picked(), ctx(trip, now)).photo;
    assert.equal(kstDate(last.takenAt), '2026-10-19');
    assert.equal(last.source, 'estimated');
    assert.equal(last.spotId, undefined);
    assert.equal(last.uploadedAt, now);
    assert.equal(isDateAssigned(last), true);
    const chosen = buildPhoto(picked(), { ...ctx(trip, now), id: 'ph-2', fallbackDate: '2026-10-18' }).photo;
    assert.equal(kstDate(chosen.takenAt), '2026-10-18');
    // 기간 밖 fallbackDate는 무시한다
    const bad = buildPhoto(picked(), { ...ctx(trip, now), id: 'ph-3', fallbackDate: '2026-10-25' }).photo;
    assert.equal(kstDate(bad.takenAt), '2026-10-19');
    // 여행 전이면 첫날
    const early = buildPhoto(picked(), ctx(trip, atKst('2026-10-10', '10:00'))).photo;
    assert.equal(kstDate(early.takenAt), '2026-10-17');
    // 그 날짜 일기에 '날짜만 정한 사진' 묶음으로 들어간다
    trip.photos = [chosen];
    const drafts = diaryBlocks(trip, '2026-10-18');
    assert.deepEqual(drafts.map((d) => [d.block.placeName, d.block.photoIds]), [[DATED_PLACE_NAME, ['ph-2']]]);
    // 기간 안에 올린 사진은 날짜 지정이 아니다
    assert.equal(isDateAssigned(buildPhoto(picked(), ctx(trip, atKst('2026-10-18', '11:30'))).photo), false);
  });

  test('여행 기간 밖에 찍은 EXIF 사진은 따로 센다', () => {
    const trip = scenarioTrip();
    const { photo } = buildPhoto(picked({ exif: { takenAt: atKst('2026-10-10', '10:00') } }), ctx(trip, atKst('2026-10-18', '10:00')));
    trip.photos = [photo];
    assert.equal(photosOutsideTrip(trip).length, 1);
  });

  test('이동 중이면 직전에 떠난 스팟, 첫 도착 전이면 스팟 없음', () => {
    const trip = scenarioTrip();
    const p = plan(trip);
    assert.equal(spotAt(trip, p, atKst('2026-10-18', '11:00')), 's-gj-bulguksa');
    assert.equal(spotAt(trip, p, atKst('2026-10-18', '09:10')), undefined);
    assert.equal(spotAt(trip, p, atKst('2026-10-17', '11:00')), undefined);
  });

  test('실제 도착 기록이 있으면 계획보다 먼저 쓴다', () => {
    const trip = scenarioTrip();
    trip.visits.push({
      id: 'v1',
      spotId: 's-gj-hwangnidan',
      date: '2026-10-18',
      memberId: memberId('minji'),
      arrivedAt: atKst('2026-10-18', '11:00'),
      status: 'arrived',
      source: 'sim',
      at: atKst('2026-10-18', '11:00'),
    });
    assert.equal(spotAt(trip, plan(trip), atKst('2026-10-18', '11:30')), 's-gj-hwangnidan');
  });
});

describe('FR-701 10MB 압축 판정', () => {
  test('10MB 이하는 그대로, 넘으면 압축 대상이고 원본·압축 크기를 남긴다', () => {
    assert.deepEqual(compressionFor(PHOTO_MAX_BYTES), {
      compressed: false,
      bytes: PHOTO_MAX_BYTES,
      originalBytes: PHOTO_MAX_BYTES,
      quality: 1,
    });
    const c = compressionFor(PHOTO_MAX_BYTES + 1);
    assert.equal(c.compressed, true);
    assert.equal(c.originalBytes, PHOTO_MAX_BYTES + 1);
    assert.ok(c.bytes <= PHOTO_MAX_BYTES, `${c.bytes}`);
    assert.ok(c.quality > 0 && c.quality < 1);
    const { photo } = buildPhoto(picked({ bytes: 14_000_000 }), ctx(scenarioTrip(), atKst('2026-10-18', '12:00')));
    assert.equal(photo.compressed, true);
    assert.equal(photo.originalBytes, 14_000_000);
    assert.ok(photo.bytes < photo.originalBytes);
    assert.equal(stillOverLimit(photo), false);
  });

  test('아주 큰 사진은 압축해도 한도를 넘을 수 있음을 알리고, 크기를 모르면 판정하지 않는다', () => {
    const big = compressionFor(60_000_000);
    assert.equal(big.compressed, true);
    assert.equal(stillOverLimit(big), true);
    const unknown = compressionFor(0);
    assert.equal(unknown.compressed, false);
    assert.equal(formatBytes(0), '크기 알 수 없음');
    assert.equal(formatBytes(850_000), '830KB');
  });
});

describe('사진 저장 규칙', () => {
  test('blob:·data: 주소는 문서에 넣지 않고 sessionOnly로 메모리에만 둔다', () => {
    assert.equal(isForbiddenUri('blob:http://x/1'), true);
    assert.equal(isForbiddenUri('data:image/png;base64,AAA'), true);
    assert.equal(isForbiddenUri('file:///a.jpg'), false);
    const r = buildPhoto(picked({ uri: 'blob:http://localhost/abc' }), ctx(scenarioTrip(), atKst('2026-10-18', '12:00')));
    assert.equal(r.photo.uri, undefined);
    assert.equal(r.photo.sessionOnly, true);
    assert.equal(r.sessionUri, 'blob:http://localhost/abc');
    const web = buildPhoto(picked({ uri: 'file:///x.jpg', sessionOnly: true }), ctx(scenarioTrip(), atKst('2026-10-18', '12:00')));
    assert.equal(web.photo.uri, undefined);
    assert.equal(web.photo.sessionOnly, true);
  });

  test('journal/photoAdded validate는 blob:·data: uri와 남의 사진을 거부한다', () => {
    const trip = scenarioTrip();
    const base: Photo = {
      id: 'ph-x',
      memberId: memberId('minji'),
      bytes: 1,
      originalBytes: 1,
      compressed: false,
      takenAt: 1,
      source: 'estimated',
      uploadedAt: 1,
    };
    for (const uri of ['blob:http://a/b', 'data:image/jpeg;base64,xx']) {
      const r = validateOp(trip, op({ type: 'journal/photoAdded', photo: { ...base, uri } }));
      assert.equal(r.ok, false, uri);
    }
    assert.equal(validateOp(trip, op({ type: 'journal/photoAdded', photo: { ...base, uri: 'file:///ok.jpg' } })).ok, true);
    assert.equal(
      validateOp(trip, op({ type: 'journal/photoAdded', photo: base }, { actorId: memberId('junho') })).ok,
      false,
    );
  });

  test('종료 뒤에도 사진을 올릴 수 있다(잠금 예외)', () => {
    const trip = scenarioTrip();
    const photo: Photo = {
      id: 'ph-late',
      memberId: memberId('minji'),
      bytes: 1,
      originalBytes: 1,
      compressed: false,
      takenAt: 1,
      source: 'estimated',
      uploadedAt: 1,
    };
    const late = op({ type: 'journal/photoAdded', photo }, { at: atKst('2026-11-02', '10:00') });
    assert.deepEqual(validateOp(trip, late), { ok: true });
    assert.equal(applyOp(trip, late)?.photos.length, 1);
  });
});

describe('journal/photoRemoved', () => {
  test('사진을 지우고 일기 블록 photoIds에서도 뺀다. 나간 올린 사람도 자기 사진은 지운다', () => {
    const trip = scenarioTrip();
    const photo = (id: string, who: string): Photo => ({
      id,
      memberId: who,
      bytes: 1,
      originalBytes: 1,
      compressed: false,
      takenAt: atKst('2026-10-18', '10:00'),
      source: 'estimated',
      uploadedAt: 1,
      spotId: 's-gj-bulguksa',
    });
    trip.photos = [photo('p1', memberId('jiwoo')), photo('p2', memberId('minji'))];
    trip.diaries['2026-10-18'] = {
      date: '2026-10-18',
      status: 'auto',
      generatedAt: 1,
      blocks: [{ id: 'b1', time: '09:25', placeName: '불국사', photoIds: ['p1', 'p2'], text: '좋았다', editedAt: 3 }],
    };
    trip.members = trip.members.map((m) => (m.id === memberId('jiwoo') ? { ...m, leftAt: 5, leftReason: 'deleted' } : m));
    const rm = op({ type: 'journal/photoRemoved', photoId: 'p1' }, { actorId: memberId('jiwoo') });
    assert.deepEqual(validateOp(trip, rm), { ok: true });
    const next = applyOp(trip, rm) as Trip;
    assert.deepEqual(next.photos.map((p) => p.id), ['p2']);
    assert.deepEqual(next.diaries['2026-10-18'].blocks[0].photoIds, ['p2']);
    assert.equal(next.diaries['2026-10-18'].blocks[0].text, '좋았다');
    // 나간 멤버는 남의 사진을 지우지 못한다
    assert.equal(validateOp(trip, op({ type: 'journal/photoRemoved', photoId: 'p2' }, { actorId: memberId('jiwoo') })).ok, false);
    assert.equal(validateOp(trip, op({ type: 'journal/photoRemoved', photoId: 'nope' })).ok, false);
    // 남의 사진은 방장이라도 지우지 못한다(탈퇴 멤버 사진 정책 미결정)
    assert.equal(validateOp(trip, op({ type: 'journal/photoRemoved', photoId: 'p2' }, { actorId: memberId('junho') })).ok, false);
    assert.equal(validateOp(trip, op({ type: 'journal/photoRemoved', photoId: 'p1' }, { actorId: memberId('minji') })).ok, false);
    assert.deepEqual(validateOp(trip, op({ type: 'journal/photoRemoved', photoId: 'p2' }, { actorId: memberId('minji') })), { ok: true });
  });

  test('고치지 않은 문단은 사진이 빠지면 자동 문장을 비우고, 사진도 도착 기록도 없어진 문단은 뺀다', () => {
    const trip = scenarioTrip();
    const ph = (id: string, spotId?: string): Photo => ({
      id,
      memberId: memberId('minji'),
      bytes: 1,
      originalBytes: 1,
      compressed: false,
      takenAt: atKst('2026-10-18', '10:00'),
      source: 'exif',
      uploadedAt: 1,
      ...(spotId ? { spotId } : {}),
    });
    trip.photos = [ph('p1', 's-gj-bulguksa'), ph('p2', 's-gj-bulguksa'), ph('p3')];
    trip.diaries['2026-10-18'] = {
      date: '2026-10-18',
      status: 'auto',
      generatedAt: 1,
      blocks: [
        { id: 'b1', time: '09:25', spotId: 's-gj-bulguksa', placeName: '불국사', photoIds: ['p1', 'p2'], text: '사진 2장을 남겼다.' },
        { id: 'b2', time: '10:00', placeName: '이동 중', photoIds: ['p3'], text: '사진 1장을 남겼다.' },
      ],
    };
    let doc = applyOp(trip, op({ type: 'journal/photoRemoved', photoId: 'p1' })) as Trip;
    assert.deepEqual(doc.diaries['2026-10-18'].blocks[0].photoIds, ['p2']);
    assert.equal(doc.diaries['2026-10-18'].blocks[0].text, '');
    doc = applyOp(doc, op({ type: 'journal/photoRemoved', photoId: 'p3' })) as Trip;
    assert.deepEqual(doc.diaries['2026-10-18'].blocks.map((b) => b.id), ['b1']);
  });
});

describe('journal/visit', () => {
  test('다른 멤버 이름으로 방문 기록을 쓰지 못한다', () => {
    const trip = scenarioTrip();
    const v = { id: 'v9', spotId: 's-gj-bulguksa', date: '2026-10-18', memberId: memberId('junho'), arrivedAt: 1, status: 'arrived' as const, source: 'manual' as const, at: 1 };
    assert.equal(validateOp(trip, op({ type: 'journal/visit', visit: v })).ok, false);
    assert.equal(validateOp(trip, op({ type: 'journal/visit', visit: v }, { actorId: memberId('junho') })).ok, true);
  });

  test('같은 id는 visit.at이 늦은 쪽이 남는다', () => {
    const trip = scenarioTrip();
    const v = {
      id: 'v1',
      spotId: 's-gj-bulguksa',
      date: '2026-10-18',
      memberId: memberId('minji'),
      arrivedAt: 100,
      status: 'arrived' as const,
      source: 'sim' as const,
      at: 100,
    };
    let doc = applyOp(trip, op({ type: 'journal/visit', visit: v })) as Trip;
    doc = applyOp(doc, op({ type: 'journal/visit', visit: { ...v, status: 'cancelled', at: 200 } })) as Trip;
    doc = applyOp(doc, op({ type: 'journal/visit', visit: { ...v, status: 'skipped', at: 150 } })) as Trip;
    assert.equal(doc.visits.length, 1);
    assert.equal(doc.visits[0].status, 'cancelled');
  });
});

describe('createSimPhotoProvider', () => {
  test('결정적이고 3장 중 1장은 EXIF가 없으며 번들 이미지 없이 sim 메타를 준다', async () => {
    const mk = () =>
      createSimPhotoProvider({ clock: fixedClock(atKst('2026-10-18', '10:00')), getPosition: () => BULGUKSA, seed: 7 });
    const a = mk();
    const b = mk();
    const first = [...(await a.pick({ multiple: true })), ...(await a.pick({ multiple: true }))];
    const second = [...(await b.pick({ multiple: true })), ...(await b.pick({ multiple: true }))];
    assert.deepEqual(first, second);
    assert.equal(first.length, 6);
    assert.deepEqual(
      first.map((p) => p.exif != null),
      [true, true, false, true, true, false],
    );
    for (const p of first) {
      assert.ok(p.sim && p.sim.label.length > 0);
      assert.ok(p.sim.tone >= 0 && p.sim.tone <= 3);
      assert.equal(isForbiddenUri(p.uri), false);
    }
    assert.ok(first.some((p) => p.bytes > PHOTO_MAX_BYTES), '10MB 넘는 사진이 섞인다');
    const withExif = first.find((p) => p.exif?.coord);
    assert.ok(withExif);
    const other = createSimPhotoProvider({ clock: fixedClock(0), getPosition: () => undefined, seed: 8 });
    assert.notDeepEqual((await other.pick({ multiple: true })).map((p) => p.sim?.label), first.slice(0, 3).map((p) => p.sim?.label));
  });

  test('모의 사진은 uri 대신 sim으로 문서에 들어간다', async () => {
    const prov = createSimPhotoProvider({ clock: fixedClock(atKst('2026-10-18', '09:50')), getPosition: () => BULGUKSA, seed: 1 });
    const [p] = await prov.pick({ multiple: false });
    const { photo, sessionUri } = buildPhoto(p, ctx(scenarioTrip(), atKst('2026-10-18', '09:50')));
    assert.equal(photo.uri, undefined);
    assert.equal(sessionUri, undefined);
    assert.ok(photo.sim);
    assert.equal(photo.spotId, 's-gj-bulguksa');
  });
});

describe('EXIF 해석', () => {
  test('시각은 시간대가 없으면 KST, 오프셋이 있으면 따른다', () => {
    assert.equal(parseExifDate('2026:10:18 10:12:05'), atKst('2026-10-18', '10:12') + 5000);
    assert.equal(parseExifDate('2026:10:18 10:12:05', '+00:00'), atKst('2026-10-18', '19:12') + 5000);
    assert.equal(parseExifDate('없음'), undefined);
  });

  test('시계 미설정 값이나 없는 날짜는 EXIF 시각이 없는 것으로 본다', () => {
    for (const v of ['0000:00:00 00:00:00', '2026:13:40 10:00:00', '2026:02:30 10:00:00', '2026:10:18 25:00:00', '1969:12:31 10:00:00']) {
      assert.equal(parseExifDate(v), undefined, v);
    }
    assert.equal(parseExif({ DateTimeOriginal: '0000:00:00 00:00:00' }), undefined);
    const { photo } = buildPhoto(
      picked({ exif: parseExif({ DateTimeOriginal: '0000:00:00 00:00:00' }) }),
      ctx(scenarioTrip(), atKst('2026-10-18', '11:30')),
    );
    assert.equal(photo.source, 'estimated');
  });

  test('GPS는 숫자·유리수 문자열·배열, iOS 중첩 사전을 읽는다', () => {
    assert.ok(Math.abs((parseDegrees('35/1,47/1,2436/100') as number) - 35.7901) < 0.0001);
    assert.equal(parseDegrees([35, 30, 0]), 35.5);
    const ios = parseExif({ '{Exif}': { DateTimeOriginal: '2026:10:18 09:40:00' }, '{GPS}': { Latitude: 35.7901, LatitudeRef: 'N', Longitude: 129.332, LongitudeRef: 'E' } });
    assert.deepEqual(ios, { takenAt: atKst('2026-10-18', '09:40'), coord: BULGUKSA });
    const android = parseExif({ DateTime: '2026:10:18 09:40:00', GPSLatitude: '35/1,47/1,2436/100', GPSLatitudeRef: 'S', GPSLongitude: 129.332, GPSLongitudeRef: 'W' });
    assert.ok(android?.coord && android.coord.latitude < 0 && android.coord.longitude < 0);
    assert.equal(parseExif({}), undefined);
    assert.equal(parseExif(null), undefined);
  });
});
