import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import type { Member, Op, OpBody, Photo, Place, Spot, Trip } from '../src/types';
import type { FetchLike } from '../src/core/ports';
import { DELETED_MEMBER_NAME as APP_DELETED_MEMBER_NAME, INVITE_TTL_MS, NICKNAME_MAX as APP_NICKNAME_MAX } from '../src/core/constants';
import { foldOps } from '../src/core/ops';
import { buildDays } from '../src/core/trip/create';
import { retentionUntil as appRetentionUntil } from '../src/core/tripStatus';
import { atKst } from '../src/core/util';
import { createHttpTransport } from '../src/services/sync/http';
import { allowResetFromEnv, createSyncStore, startSyncServer, storeFromEnv, type SyncStore } from '../server/sync-server.mjs';
import { migrate } from '../server/db/migrate.mjs';
import { createPostgresStore, openPostgresStore, sqlDb, type PostgresSyncStore, type SqlDb } from '../server/db/postgres-store.mjs';
import { emptyView, legKey, projectOps } from '../server/db/projection.mjs';
import { DELETED_MEMBER_NAME, NICKNAME_MAX, redactLog } from '../server/redact.mjs';
import { DAY_MS, MAX_TIME_MS, ORPHAN_RETENTION_MS, ROUTE_CACHE_TTL_MS, retentionUntil } from '../server/retention.mjs';

/**
 * WP2 동기화 서버 PostgreSQL 영속화(2026-10-09 결정).
 * 같은 SQL을 PGlite(WASM Postgres, 데몬 없음)로 돌린다. YT_TEST_DATABASE_URL이 있으면 실제 PostgreSQL로도 돈다
 * (임시 스키마를 만들어 쓰고 지운다). 멱등 op, seq 순서, after 조회, 초대 색인, 조회용 표, 보관 정리, 마이그레이션 재실행,
 * HTTP(/health, 전송, 시연 리셋 잠금), 시작 설정(붙지 못하면 멈춤)을 본다. 결과 모양은 메모리 저장소와 맞춰 본다.
 * 리뷰 반영: 서버가 다루지 못하는 시각·날짜, 키로 못 쓰는 id, 동시 모호 장소 고르기, 방장 아닌 기간 변경,
 * 밀린 조회용 표의 보관 판정, 생성 op 없는 방 정리, 계정 탈퇴 가리기.
 */

const T0 = atKst('2026-10-01', '10:00');
const host: Member = { id: 'm-host', userId: 'u-host', nickname: '민지', role: 'host', isGuest: true, canInvite: false, joinedAt: T0 };
const junho: Member = { id: 'm-junho', userId: 'u-junho', nickname: '준호', role: 'member', isGuest: true, canInvite: false, joinedAt: T0 };

/** 종료일이 기본 시작일(10/17)보다 이르면 시작일도 종료일로 당긴다(지난 여행 보관 정리용) */
function tripBody(id: string, endDate = '2026-10-19', extra: Partial<Trip> = {}): Omit<Trip, 'lastSeq'> {
  const start = endDate < '2026-10-17' ? endDate : '2026-10-17';
  return {
    id,
    title: '경주 2박 3일',
    region: 'gyeongju',
    startDate: start,
    endDate,
    transport: 'car',
    dayStart: '09:00',
    dayEnd: '21:00',
    days: buildDays(start, endDate, null),
    legs: [],
    members: [host, junho],
    spots: [],
    messages: [],
    photos: [],
    visits: [],
    diaries: {},
    createdAt: T0,
    createdBy: host.userId,
    ...extra,
  };
}

let n = 0;
function op(tripId: string, body: OpBody, at?: number, actorId = host.id): Op {
  n += 1;
  return { id: `dbop-${String(n).padStart(4, '0')}`, tripId, actorId, at: at ?? T0 + n * 1000, ...body } as Op;
}

let coordN = 0;
function spot(id: string, placeId: string, name: string, extra: Partial<Spot> = {}): Spot {
  coordN += 1;
  return {
    id,
    placeId,
    name,
    category: '관광지',
    coord: { latitude: 35.83 + coordN * 0.001, longitude: 129.21 + coordN * 0.001 },
    proposals: [],
    pinned: false,
    stayMin: 60,
    createdAt: T0,
    edited: {},
    ...extra,
  };
}

const place = (placeId: string, name: string): Place => ({ placeId, name, coord: { latitude: 35.79, longitude: 129.33 }, category: '카페' });

const invite = (code: string, at: number, capacity = 6) => ({ code, issuedAt: at, expiresAt: at + INVITE_TTL_MS, capacity });

/** 앱이 로그를 접은 문서 → 조회용 표 모양(readView와 비교) */
function viewOfDoc(doc: Trip) {
  const byId = <T extends { id?: string; date?: string }>(a: T[], key: (x: T) => string) => [...a].sort((x, y) => (key(x) < key(y) ? -1 : 1));
  return {
    trip: {
      title: doc.title,
      region: doc.region,
      startDate: doc.startDate,
      endDate: doc.endDate,
      transport: doc.transport,
      dayStart: doc.dayStart,
      dayEnd: doc.dayEnd,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      deletedAt: doc.deletedAt ?? null,
      invite: doc.invite
        ? {
            code: doc.invite.code,
            issuedAt: doc.invite.issuedAt,
            expiresAt: doc.invite.expiresAt,
            capacity: doc.invite.capacity,
            revokedAt: doc.invite.revokedAt ?? null,
          }
        : null,
    },
    spots: byId(doc.spots, (s) => s.id).map((s) => ({
      id: s.id,
      placeId: s.placeId,
      name: s.name,
      category: s.category,
      kind: s.kind ?? null,
      lat: s.coord.latitude,
      lng: s.coord.longitude,
      address: s.address ?? null,
      pinned: s.pinned,
      stayMin: s.stayMin,
      fixedDate: s.fixedDate ?? null,
      manualDate: s.manualOrder?.date ?? null,
      manualIndex: s.manualOrder?.index ?? null,
      arriveOverride: s.arriveOverride ?? null,
      removed: s.removedByUser === true,
      removedReason: s.removedReason ?? null,
      messageIds: [...new Set(s.proposals.flatMap((p) => (p.messageId ? [p.messageId] : [])))],
      manual: s.proposals.some((p) => !p.messageId),
      createdAt: s.createdAt,
      edited: s.edited,
    })),
    days: byId(doc.days, (d) => d.date).map((d) => ({
      date: d.date,
      baseMode: d.base === 'inherit' ? 'inherit' : d.base === null ? 'firstSpot' : 'set',
      baseName: d.base && d.base !== 'inherit' ? d.base.name : null,
      baseLat: d.base && d.base !== 'inherit' ? d.base.coord.latitude : null,
      baseLng: d.base && d.base !== 'inherit' ? d.base.coord.longitude : null,
      basePlaceId: d.base && d.base !== 'inherit' ? (d.base.placeId ?? null) : null,
      noReturn: d.noReturn === true,
      dayStart: d.dayStart ?? null,
      dayEnd: d.dayEnd ?? null,
      transport: d.transport ?? null,
      edited: d.edited ?? {},
    })),
    legs: [...doc.legs]
      .sort((a, b) => (legKey(a.date, a.fromId, a.toId) < legKey(b.date, b.fromId, b.toId) ? -1 : 1))
      .map((l) => ({ date: l.date, fromId: l.fromId, toId: l.toId, transport: l.transport, at: l.at ?? null, cleared: l.cleared === true })),
  };
}

/** 메모리와 Postgres에 같은 배치를 넣고 확인 응답이 같은지 본다. */
async function pushBoth(mem: SyncStore, pg: SyncStore, tripId: string, ops: unknown[], now = T0) {
  const a = await mem.push(tripId, ops, now);
  const b = await pg.push(tripId, ops, now);
  assert.deepEqual(b, a, '확인 응답이 메모리 저장소와 같다');
  return b;
}

interface Opened {
  db: SqlDb;
  /** 같은 스키마로 붙는 연결 문자열(실제 PostgreSQL만). openPostgresStore를 실제 드라이버로 돌릴 때 쓴다 */
  url?: string;
  close(): Promise<void>;
}

async function openPglite(): Promise<Opened> {
  const pg = new PGlite();
  await pg.waitReady;
  return { db: sqlDb(pg), close: () => pg.close() };
}

const PG_URL = process.env.YT_TEST_DATABASE_URL;

/** 실제 PostgreSQL. 임시 스키마를 만들어 search_path로 쓰고, 끝나면 지운다. */
async function openRealPostgres(): Promise<Opened> {
  const { default: pg } = await import('pg');
  const schema = `yt_test_${process.pid}_${Date.now().toString(36)}`;
  const admin = new pg.Pool({ connectionString: PG_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: PG_URL, max: 5, options: `-c search_path=${schema}` });
  const url = `${PG_URL}${PG_URL?.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
  return {
    db: sqlDb(pool),
    url,
    close: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

const BACKENDS: { name: string; open: () => Promise<Opened>; skip: string | false; real: boolean }[] = [
  { name: 'PGlite', open: openPglite, skip: false, real: false },
  { name: '실제 PostgreSQL', open: openRealPostgres, skip: PG_URL ? false : 'YT_TEST_DATABASE_URL이 없어 건너뜀', real: true },
];

for (const backend of BACKENDS) {
  describe(`PostgreSQL 저장소(${backend.name})`, { skip: backend.skip }, () => {
    let opened: Opened;
    let db: SqlDb;
    let store: PostgresSyncStore;
    const warnings: string[] = [];
    let firstMigration: number[] = [];

    before(async () => {
      opened = await backend.open();
      db = opened.db;
      firstMigration = await migrate(db);
      store = createPostgresStore(db, { warn: (m) => warnings.push(m) });
    });
    after(async () => {
      await opened?.close();
    });

    const count = async (table: string, tripId: string) =>
      Number((await db.query(`SELECT count(*)::int AS c FROM ${table} WHERE trip_id = $1`, [tripId])).rows[0].c);

    test('마이그레이션: 처음 적용하면 1·2번이 기록되고, 다시 돌려도(동시에 두 번 포함) 아무것도 적용하지 않는다', async () => {
      assert.deepEqual(firstMigration, [1, 2]);
      assert.deepEqual(await Promise.all([migrate(db), migrate(db)]), [[], []]);
      const { rows } = await db.query('SELECT version, name FROM schema_migrations ORDER BY version');
      assert.deepEqual(rows.map((r) => [r.version, r.name]), [
        [1, '001_init.sql'],
        [2, '002_auth.sql'],
      ]);
    });

    test('적용한 마이그레이션 파일이 바뀌면(체크섬 불일치) 멈춘다', async () => {
      const { rows } = await db.query('SELECT checksum FROM schema_migrations WHERE version = 1');
      await db.query("UPDATE schema_migrations SET checksum = 'changed' WHERE version = 1");
      await assert.rejects(migrate(db), /001_init\.sql이 적용된 뒤 바뀌었습니다/);
      await db.query('UPDATE schema_migrations SET checksum = $1 WHERE version = 1', [rows[0].checksum]);
      assert.deepEqual(await migrate(db), []);
    });

    test('멱등·seq: 받은 순서대로 매기고, 같은 id는 배치 안이든 다음 배치든 처음 seq로 확인 응답만 한다', async () => {
      const mem = createSyncStore();
      const create = op('trip-seq', { type: 'trip/create', trip: tripBody('trip-seq') }, T0);
      const a = op('trip-seq', { type: 'trip/setDay', date: '2026-10-18', patch: { noReturn: true } });
      const b = op('trip-seq', { type: 'trip/setDay', date: '2026-10-19', patch: { noReturn: true } });
      assert.deepEqual(await pushBoth(mem, store, 'trip-seq', [create, a, a]), [
        { opId: create.id, seq: 1 },
        { opId: a.id, seq: 2 },
        { opId: a.id, seq: 2 },
      ]);
      assert.deepEqual(await pushBoth(mem, store, 'trip-seq', [b, a, create]), [
        { opId: b.id, seq: 3 },
        { opId: a.id, seq: 2 },
        { opId: create.id, seq: 1 },
      ]);
      assert.deepEqual((await store.pull('trip-seq', 0)).map((o) => o.seq), [1, 2, 3]);
      assert.deepEqual((await store.pull('trip-seq', 1)).map((o) => o.id), [a.id, b.id]);
      assert.deepEqual(await store.pull('trip-seq', 3), []);
      assert.deepEqual(await store.pull('trip-seq', 0), mem.pull('trip-seq', 0), 'pull도 메모리 저장소와 같다');
      assert.deepEqual(await store.pull('nowhere', 0), []);
      assert.equal(await count('trip_ops', 'trip-seq'), 3);
    });

    test('다른 방 op·id 없는 op는 건너뛰고, 클라이언트가 보낸 seq는 서버 seq로 바꾼다', async () => {
      const mem = createSyncStore();
      const create = op('trip-skip', { type: 'trip/create', trip: tripBody('trip-skip') }, T0);
      const stranger = op('trip-other', { type: 'trip/delete' });
      const forged = { ...op('trip-skip', { type: 'trip/delete' }), seq: 99 };
      const acks = await pushBoth(mem, store, 'trip-skip', [{ tripId: 'trip-skip' }, stranger, null, create, forged]);
      assert.deepEqual(acks, [
        { opId: create.id, seq: 1 },
        { opId: forged.id, seq: 2 },
      ]);
      assert.deepEqual(await store.push('trip-empty', [stranger]), [], '받을 op가 없으면 방을 만들지 않는다');
      assert.equal((await db.query("SELECT count(*)::int AS c FROM trips WHERE trip_id = 'trip-empty'")).rows[0].c, 0);
      assert.deepEqual((await store.pull('trip-skip', 1))[0], { ...forged, seq: 2 });
    });

    test('본문은 받은 그대로 돌려준다. jsonb가 못 받는 NUL 문자는 U+FFFD로 바꾼다', async () => {
      const create = op('trip-body', { type: 'trip/create', trip: tripBody('trip-body') }, T0);
      const text = '따옴표 " 역슬래시 \\ 줄바꿈\n탭\t{"json":[1,2]} 불국사';
      const chat = op('trip-body', { type: 'chat/send', message: { id: 'msg-1', text } }, T0 + 1000, junho.id);
      const nul = op('trip-body', { type: 'chat/send', message: { id: 'msg-2', text: 'a\u0000b' } }, T0 + 2000, junho.id);
      await store.push('trip-body', [create, chat, nul]);
      const got = await store.pull('trip-body', 0);
      assert.deepEqual(got[0], { ...create, seq: 1 });
      assert.deepEqual(got[1], { ...chat, seq: 2 });
      assert.equal((got[2] as unknown as { message: { text: string } }).message.text, 'a�b');
    });

    test('같은 방에 동시에 push해도 seq가 겹치거나 비지 않는다', async () => {
      const create = op('trip-race', { type: 'trip/create', trip: tripBody('trip-race') }, T0);
      await store.push('trip-race', [create]);
      const batches = Array.from({ length: 6 }, (_, i) =>
        [0, 1, 2].map((j) => op('trip-race', { type: 'trip/setDay', date: '2026-10-18', patch: { noReturn: (i + j) % 2 === 0 } })),
      );
      const acks = (await Promise.all(batches.map((b) => store.push('trip-race', b)))).flat();
      assert.deepEqual(acks.map((a) => a.seq).sort((x, y) => x - y), Array.from({ length: 18 }, (_, i) => i + 2));
      assert.equal((await db.query("SELECT last_seq FROM trips WHERE trip_id = 'trip-race'")).rows[0].last_seq, 19);
    });

    test('초대 색인: 조회 결과가 메모리 저장소와 같다(ok, 재발급 revoked, 무효화, 만료, 정원, 삭제된 방, 없음)', async () => {
      const mem = createSyncStore();
      const guest = (id: string): Member => ({ id, userId: `u-${id}`, nickname: id, role: 'member', isGuest: true, canInvite: false, joinedAt: T0 });
      // 방 1: 코드 발급 → 재발급(옛 코드 revoked), 정원 3에 한 명 합류하면 꽉 찬다
      await pushBoth(mem, store, 'trip-inv1', [
        op('trip-inv1', { type: 'trip/create', trip: tripBody('trip-inv1') }, T0),
        op('trip-inv1', { type: 'trip/issueInvite', invite: invite('INVA-0001', T0 + 100) }, T0 + 100),
        op('trip-inv1', { type: 'trip/issueInvite', invite: invite('INVA-0002', T0 + 200, 3) }, T0 + 200),
      ]);
      // 방 2: 발급 뒤 무효화, 방 3: 발급 뒤 삭제
      await pushBoth(mem, store, 'trip-inv2', [
        op('trip-inv2', { type: 'trip/create', trip: tripBody('trip-inv2') }, T0),
        op('trip-inv2', { type: 'trip/issueInvite', invite: invite('INVB-0001', T0 + 100) }, T0 + 100),
        op('trip-inv2', { type: 'trip/revokeInvite' }, T0 + 300),
      ]);
      await pushBoth(mem, store, 'trip-inv3', [
        op('trip-inv3', { type: 'trip/create', trip: tripBody('trip-inv3') }, T0),
        op('trip-inv3', { type: 'trip/issueInvite', invite: invite('INVC-0001', T0 + 100) }, T0 + 100),
        op('trip-inv3', { type: 'trip/delete' }, T0 + 400),
      ]);
      const now = T0 + 10_000;
      const codes = ['INVA-0001', 'INVA-0002', 'INVB-0001', 'INVC-0001', 'NONE-0000'];
      const check = async (at: number) => {
        for (const code of codes) assert.deepEqual(await store.lookup(code, at), mem.lookup(code, at), `${code} @${at}`);
      };
      await check(now);
      assert.deepEqual(await store.lookup('INVA-0002', now), { tripId: 'trip-inv1', status: 'ok' });
      assert.deepEqual(await store.lookup('INVA-0001', now), { tripId: 'trip-inv1', error: 'revoked' });
      assert.deepEqual(await store.lookup('INVB-0001', now), { tripId: 'trip-inv2', status: 'revoked' });
      assert.deepEqual(await store.lookup('INVC-0001', now), { error: 'notFound' });
      await pushBoth(mem, store, 'trip-inv1', [op('trip-inv1', { type: 'member/join', member: guest('m-c'), inviteCode: 'INVA-0002' }, T0 + 500, 'm-c')]);
      assert.deepEqual(await store.lookup('INVA-0002', now), { tripId: 'trip-inv1', status: 'full' });
      await check(now);
      await check(T0 + 200 + INVITE_TTL_MS);
      assert.deepEqual(
        (await db.query("SELECT code, issued_seq FROM invite_codes WHERE trip_id = 'trip-inv1' ORDER BY code")).rows,
        [
          { code: 'INVA-0001', issued_seq: 2 },
          { code: 'INVA-0002', issued_seq: 3 },
        ],
      );
    });

    test('조회용 표: 여행방·스팟·날짜별 일정·구간 수단이 앱이 로그를 접은 문서와 같다(늦게 온 옛 편집 포함)', async () => {
      const id = 'trip-view';
      const t = (sec: number) => T0 + sec * 1000;
      const o = (body: OpBody, sec: number, actor = host.id) => op(id, body, t(sec), actor);
      const hotel = { name: '경주 한옥 숙소', coord: { latitude: 35.84, longitude: 129.22 }, placeId: 'p-hotel' };
      const batches: Op[][] = [
        [
          o({ type: 'trip/create', trip: tripBody(id) }, 0),
          o({ type: 'spot/add', spot: spot('s1', 'p-1', '대릉원') }, 1),
          o({ type: 'spot/add', spot: spot('s2', 'p-2', '첨성대', { kind: '유적', address: '경북 경주시 인왕동' }) }, 2, junho.id),
          o({ type: 'spot/add', spot: spot('s3', 'p-3', '황리단길') }, 3),
          o({ type: 'spot/add', spot: spot('s4', 'p-4', '잘못 잡힌 곳') }, 4),
          o({ type: 'trip/issueInvite', invite: invite('VIEW-0001', t(5)) }, 5),
        ],
        [
          o({ type: 'chat/send', message: { id: 'msg-1', text: '불국사 가고 대릉원도 다시 보자' } }, 10, junho.id),
          o({ type: 'spot/extracted', messageId: 'msg-1', created: [spot('s5', 'p-5', '불국사')], mergedSpotIds: ['s1'], ambiguous: [], highlights: [] }, 11, junho.id),
          o({ type: 'chat/send', message: { id: 'msg-2', text: '카페 하나랑 석굴암' } }, 12),
          o(
            {
              type: 'spot/extracted',
              messageId: 'msg-2',
              created: [spot('s6', 'p-6', '석굴암')],
              mergedSpotIds: [],
              ambiguous: [{ phrase: '카페', options: [place('p-7', '카페 A'), place('p-8', '카페 B')] }],
              highlights: [],
            },
            13,
          ),
          o({ type: 'spot/resolveAmbiguous', messageId: 'msg-2', phrase: '카페', spot: spot('s7', 'p-7', '카페 A') }, 14),
          o({ type: 'spot/undoExtraction', messageId: 'msg-2' }, 15),
        ],
        [
          o({ type: 'spot/pin', spotId: 's3', pinned: true }, 20),
          o({ type: 'spot/remove', spotId: 's3' }, 21, junho.id),
          o({ type: 'spot/restore', spotId: 's3' }, 22),
          o({ type: 'spot/delete', spotId: 's4' }, 23),
          o({ type: 'schedule/setStay', spotId: 's1', stayMin: 90 }, 50),
          o({ type: 'schedule/setArrive', spotId: 's2', arrive: '11:30' }, 24),
          o({ type: 'schedule/reorder', date: '2026-10-18', spotIds: ['s2', 's1'] }, 25),
          o({ type: 'schedule/setDate', spotId: 's1', date: '2026-10-19' }, 26),
          o({ type: 'schedule/setDate', spotId: 's2', date: '2026-10-18' }, 27),
          o({ type: 'schedule/setDayTransport', date: '2026-10-18', transport: 'walk' }, 28),
          o({ type: 'schedule/setLegTransport', date: '2026-10-18', fromId: 'base', toId: 's2', transport: 'walk' }, 60),
          o({ type: 'schedule/setLegTransport', date: '2026-10-18', fromId: 'base', toId: 's2', transport: null }, 70),
          o({ type: 'schedule/setLegTransport', date: '2026-10-18', fromId: 's2', toId: 's1', transport: 'transit' }, 61),
          o({ type: 'trip/setDay', date: '2026-10-17', patch: { base: hotel } }, 30),
          o({ type: 'trip/setDay', date: '2026-10-19', patch: { noReturn: true, dayEnd: '18:00' } }, 31, junho.id),
        ],
        [
          // 늦게 도착한 옛 편집(저장 시각이 더 이르다): 체류·구간 모두 나중 저장이 남는다
          o({ type: 'schedule/setStay', spotId: 's1', stayMin: 30 }, 40, junho.id),
          o({ type: 'schedule/setLegTransport', date: '2026-10-18', fromId: 'base', toId: 's2', transport: 'car' }, 65, junho.id),
          o({ type: 'trip/update', patch: { title: '  경주 3박 4일 ', endDate: '2026-10-20' } }, 80),
          o({ type: 'trip/setDay', date: '2026-10-20', patch: { noReturn: true } }, 81),
          o({ type: 'trip/revokeInvite' }, 82),
        ],
      ];
      for (const b of batches) await store.push(id, b, T0);
      const doc = foldOps(await store.pull(id, 0) as unknown as Op[]);
      assert.ok(doc);
      const view = await store.readView(id);
      assert.deepEqual(view, viewOfDoc(doc));

      // 시나리오가 실제로 그 경우들을 지났는지(문서와 같은 것만 보면 둘 다 틀려도 통과하므로)
      const s = (sid: string) => view.spots.find((x) => x.id === sid);
      assert.deepEqual(view.spots.map((x) => x.id), ['s1', 's2', 's3', 's5'], 's4 삭제, msg-2 되돌리기로 s6·s7 삭제');
      assert.equal(s('s1')?.stayMin, 90, '늦게 온 옛 체류 30분은 지지 않는다');
      assert.deepEqual([s('s1')?.manualDate, s('s1')?.fixedDate], [null, '2026-10-19'], '다른 날짜로 옮기면 수동 순서가 풀린다');
      assert.deepEqual([s('s2')?.manualDate, s('s2')?.manualIndex], ['2026-10-18', 0]);
      assert.deepEqual([s('s1')?.messageIds, s('s1')?.manual], [['msg-1'], true]);
      assert.deepEqual([s('s3')?.pinned, s('s3')?.removed], [true, false]);
      const leg = view.legs.find((l) => l.toId === 's2');
      assert.deepEqual([leg?.cleared, leg?.at], [true, t(70)], '해제 묘비가 늦게 온 옛 지정을 이긴다');
      assert.deepEqual(view.days.map((d) => d.date), ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
      assert.equal(view.trip?.title, '경주 3박 4일');
      assert.equal(view.trip?.invite?.revokedAt, t(82));

      // 표를 SQL로 바로 읽을 수 있다(조회용)
      const { rows } = await db.query(
        `SELECT spot_id, name, stay_min, to_char(fixed_date, 'YYYY-MM-DD') AS fixed_date FROM trip_spots
         WHERE trip_id = $1 AND NOT removed ORDER BY spot_id`,
        [id],
      );
      assert.deepEqual(rows[0], { spot_id: 's1', name: '대릉원', stay_min: 90, fixed_date: '2026-10-19' });
      const trip = (await db.query("SELECT title, to_char(end_date, 'YYYY-MM-DD') AS end_date, retain_until FROM trips WHERE trip_id = $1", [id])).rows[0];
      assert.equal(trip.end_date, '2026-10-20');
      assert.equal(new Date(trip.retain_until).getTime(), appRetentionUntil({ endDate: '2026-10-20' }));

      // 증분으로 갱신한 표와 로그 전체로 다시 만든 표가 같다
      assert.equal(await store.rebuildView(id), true);
      assert.deepEqual(await store.readView(id), view);
      assert.equal(await store.rebuildView('no-such-trip'), false);
    });

    test('조회용 표에는 생성 전 op, 삭제된 방의 op, 종료일이 지난 시각의 편집을 옮기지 않는다', async () => {
      const id = 'trip-guard';
      await store.push(id, [
        op(id, { type: 'spot/add', spot: spot('g0', 'p-g0', '생성 전') }, T0 - 1000),
        op(id, { type: 'trip/create', trip: tripBody(id) }, T0),
        op(id, { type: 'spot/add', spot: spot('g1', 'p-g1', '종료 뒤') }, atKst('2026-10-20', '09:00')),
        op(id, { type: 'spot/add', spot: spot('g2', 'p-g2', '마지막 날') }, atKst('2026-10-19', '23:59')),
      ]);
      assert.deepEqual((await store.readView(id)).spots.map((s) => s.id), ['g2']);
      await store.push(id, [
        op(id, { type: 'trip/delete' }, T0 + 5000),
        op(id, { type: 'spot/add', spot: spot('g3', 'p-g3', '삭제 뒤') }, T0 + 6000),
      ]);
      const v = await store.readView(id);
      assert.equal(v.trip?.deletedAt, T0 + 5000);
      assert.deepEqual(v.spots.map((s) => s.id), ['g2']);
      assert.equal(await count('trip_ops', id), 6, '로그에는 다 남는다(원천)');
    });

    test('잘못된 값은 표에 null로 들어가고 동기화를 막지 않는다', async () => {
      const id = 'trip-junk';
      const junk = {
        ...spot('j1', 'p-j1', '이상한 값'),
        stayMin: 'abc',
        fixedDate: '2026-13-45',
        coord: { latitude: 'north', longitude: null },
        createdAt: -5,
        manualOrder: { date: '2026-10-18', index: 1.5 },
        edited: { pinned: 'yesterday', stayMin: T0 },
      } as unknown as Spot;
      const acks = await store.push(id, [op(id, { type: 'trip/create', trip: tripBody(id) }, T0), op(id, { type: 'spot/add', spot: junk }, T0 + 1000)]);
      assert.deepEqual(acks.map((a) => a.seq), [1, 2]);
      const s = (await store.readView(id)).spots[0];
      assert.deepEqual(
        [s.stayMin, s.fixedDate, s.lat, s.lng, s.createdAt, s.manualDate, s.manualIndex, s.edited],
        [null, null, null, null, null, null, null, { stayMin: T0 }],
      );
    });

    test('조회용 표 갱신이 실패해도 op는 저장하고, 다음 push 때 로그로 다시 만든다', async () => {
      const id = 'trip-stale';
      await store.push(id, [op(id, { type: 'trip/create', trip: tripBody(id) }, T0)]);
      await db.query("ALTER TABLE trip_spots ADD CONSTRAINT yt_test_boom CHECK (name <> '터지는 이름')");
      warnings.length = 0;
      try {
        const boom = op(id, { type: 'spot/add', spot: spot('b1', 'p-b1', '터지는 이름') }, T0 + 1000);
        assert.deepEqual(await store.push(id, [boom]), [{ opId: boom.id, seq: 2 }]);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /조회용 표 갱신 실패\(trip-stale\)/);
        assert.equal((await db.query('SELECT view_stale FROM trips WHERE trip_id = $1', [id])).rows[0].view_stale, true);
        assert.deepEqual((await store.pull(id, 1)).map((o) => o.id), [boom.id], '로그는 저장됐다');
        assert.deepEqual((await store.readView(id)).spots, []);
      } finally {
        await db.query('ALTER TABLE trip_spots DROP CONSTRAINT yt_test_boom');
      }
      await store.push(id, [op(id, { type: 'spot/pin', spotId: 'b1', pinned: true }, T0 + 2000)]);
      assert.equal((await db.query('SELECT view_stale FROM trips WHERE trip_id = $1', [id])).rows[0].view_stale, false);
      const v = await store.readView(id);
      assert.deepEqual(v.spots.map((s) => [s.id, s.pinned]), [['b1', true]]);
    });

    test('보관 기한 정리: 종료일 다음 날 00:00 KST + 365일부터 방과 로그·색인·표를 지운다(메모리 저장소와 같다)', async () => {
      const mem = createSyncStore();
      const old = 'trip-old';
      const ops = [
        op(old, { type: 'trip/create', trip: tripBody(old, '2025-03-01', { spots: [spot('o1', 'p-o1', '지난 여행 스팟')] }) }, T0),
        op(old, { type: 'trip/issueInvite', invite: invite('OLD0-0001', T0 + 100) }, T0 + 100),
        op(old, { type: 'chat/send', message: { id: 'old-msg', text: '사진 올렸어' } }, T0 + 200),
      ];
      await pushBoth(mem, store, old, ops);
      await pushBoth(mem, store, 'trip-keep', [op('trip-keep', { type: 'trip/create', trip: tripBody('trip-keep', '2025-03-02') }, T0)]);
      const boundary = retentionUntil('2025-03-01') as number;
      assert.equal(boundary, appRetentionUntil({ endDate: '2025-03-01' }), '앱 보관 기한 계산과 같다');
      assert.equal(new Date(boundary).toISOString(), '2026-03-01T15:00:00.000Z', '2025-03-02 00:00 KST + 365일');

      assert.deepEqual(await store.purgeExpired(boundary - 1), []);
      assert.deepEqual(mem.purgeExpired(boundary - 1), []);
      assert.ok((await count('trip_spots', old)) > 0);
      assert.deepEqual(await store.purgeExpired(boundary), [old]);
      assert.deepEqual(mem.purgeExpired(boundary), [old]);
      for (const table of ['trips', 'trip_ops', 'invite_codes', 'trip_spots', 'trip_days', 'trip_legs']) {
        assert.equal(await count(table, old), 0, `${table}에서도 지웠다`);
      }
      assert.deepEqual(await store.pull(old, 0), []);
      assert.deepEqual(await store.lookup('OLD0-0001', boundary), { error: 'notFound' });
      assert.equal(await count('trips', 'trip-keep'), 1, '하루 늦게 끝난 방은 남는다');
      assert.equal((await store.pull('trip-keep', 0)).length, 1);
    });

    test('경로 캐시: 24시간 안에는 꺼내고, 지나면 없고, 정리 때 지운다', async () => {
      const key = 'osrm:car:35.83,129.21;35.79,129.33';
      const resp = { distance: 12_345, geometry: [[35.83, 129.21], [35.79, 129.33]], note: '구간 "A"' };
      await store.routeCache.put(key, resp, T0);
      assert.deepEqual(await store.routeCache.get(key, T0 + ROUTE_CACHE_TTL_MS - 1), resp);
      assert.equal(await store.routeCache.get(key, T0 + ROUTE_CACHE_TTL_MS), null);
      await store.routeCache.put(key, { ...resp, distance: 1 }, T0 + 1000);
      assert.equal(((await store.routeCache.get(key, T0 + 2000)) as { distance: number }).distance, 1, '같은 키는 덮어쓴다');
      await store.purgeExpired(T0 + 1000 + ROUTE_CACHE_TTL_MS);
      assert.equal((await db.query('SELECT count(*)::int AS c FROM route_cache')).rows[0].c, 0);
    });

    test('서버가 다루지 못하는 시각(1e15, 8.64e15)과 9999-12-31 종료일은 표에 null로 들어가고 방이 밀리지 않는다', async () => {
      const mem = createSyncStore();
      const id = 'trip-far';
      const far = 1e15;
      warnings.length = 0;
      await pushBoth(mem, store, id, [
        op(id, { type: 'trip/create', trip: tripBody(id, '2026-10-19', { createdAt: far }) }, T0),
        op(id, { type: 'trip/delete' }, far),
        op(id, { type: 'spot/add', spot: spot('f1', 'p-f1', '먼 미래', { createdAt: far }) }, T0 + 1000),
        op(id, { type: 'trip/issueInvite', invite: { ...invite('FAR0-0001', T0 + 2000), expiresAt: far } }, T0 + 2000),
        op(id, { type: 'spot/add', spot: spot('f2', 'p-f2', 'Date 끝') }, 8.64e15),
      ]);
      await pushBoth(mem, store, id, [op(id, { type: 'spot/add', spot: spot('f3', 'p-f3', '정상') }, T0 + 3000)]);
      assert.deepEqual(warnings, [], '조회용 표 갱신이 실패하지 않는다');
      const row = (await db.query('SELECT created, view_stale, retain_until FROM trips WHERE trip_id = $1', [id])).rows[0];
      assert.deepEqual([row.created, row.view_stale], [true, false]);
      assert.equal(new Date(row.retain_until).getTime(), retentionUntil('2026-10-19'), '보관 기한 정리 대상에 든다');
      const v = await store.readView(id);
      assert.deepEqual([v.trip?.createdAt, v.trip?.deletedAt, v.trip?.invite?.expiresAt], [null, null, null], '범위 밖 시각은 없는 값, 그런 시각의 op는 옮기지 않는다');
      assert.deepEqual(v.spots.map((s) => [s.id, s.createdAt]), [['f1', null], ['f3', T0]]);

      const end = 'trip-far-end';
      await pushBoth(mem, store, end, [op(end, { type: 'trip/create', trip: tripBody(end, '2026-10-19', { endDate: '9999-12-31' }) }, T0)]);
      const r2 = (await db.query("SELECT view_stale, to_char(end_date, 'YYYY-MM-DD') AS end_date, retain_until FROM trips WHERE trip_id = $1", [end])).rows[0];
      assert.deepEqual([r2.view_stale, r2.end_date, r2.retain_until], [false, '9999-12-31', null], '기한을 쓸 수 없으면 종료일로는 지우지 않는다');
      assert.deepEqual(mem.purgeExpired(MAX_TIME_MS), [id], '메모리 정리도 멈추지 않는다');
    });

    test('tripId·op.id·초대 코드가 키로 못 쓰는 값이면 그 op나 색인만 건너뛴다. 객체 키의 NUL·짝 없는 서로게이트도 U+FFFD로 바꾼다', async () => {
      const mem = createSyncStore();
      const id = 'trip-ids';
      const create = op(id, { type: 'trip/create', trip: tripBody(id) }, T0);
      const bad = (opId: string) => ({ ...op(id, { type: 'trip/setDay', date: '2026-10-18', patch: { noReturn: true } }), id: opId });
      const longCode = op(id, { type: 'trip/issueInvite', invite: invite('L'.repeat(3600), T0 + 100) }, T0 + 100);
      const message = { id: 'msg-k', text: '키', 'a\u0000b': 1, '\uD800': 2 };
      const chat = op(id, { type: 'chat/send', message } as OpBody, T0 + 200, junho.id);
      const ok = op(id, { type: 'trip/setDay', date: '2026-10-19', patch: { noReturn: true } }, T0 + 300);
      const acks = await pushBoth(mem, store, id, [create, bad('c\u0000'), bad('x'.repeat(3600)), bad('\uD800dc'), longCode, chat, ok]);
      assert.deepEqual(
        acks.map((a) => [a.opId, a.seq]),
        [
          [create.id, 1],
          [longCode.id, 2],
          [chat.id, 3],
          [ok.id, 4],
        ],
      );
      const stored = (await store.pull(id, 2))[0] as unknown as { message: Record<string, unknown> };
      assert.deepEqual(stored.message, { id: 'msg-k', text: '키', 'a�b': 1, '�': 2 });
      assert.equal(await count('invite_codes', id), 0, '키로 못 쓰는 초대 코드는 색인에 적지 않는다');
      for (const tid of ['t\u0000', 'y'.repeat(201), '\uDC00']) {
        const stray = { ...ok, id: `stray-${tid.length}`, tripId: tid };
        assert.deepEqual(await store.push(tid, [stray]), []);
        assert.deepEqual(mem.push(tid, [stray]), []);
        assert.deepEqual(await store.pull(tid, 0), []);
      }
      assert.deepEqual(await store.lookup('BAD\u0000', T0), { error: 'notFound' });
      assert.deepEqual(mem.lookup('BAD\u0000', T0), { error: 'notFound' });
    });

    test('모호한 장소를 둘이 동시에 골라도 먼저 온 것만 표에 남는다(앱이 로그를 접은 문서와 같다)', async () => {
      const id = 'trip-pick';
      const t = (sec: number) => T0 + sec * 1000;
      const o = (body: OpBody, sec: number, actor = host.id) => op(id, body, t(sec), actor);
      const ambiguous = [
        { phrase: '카페', options: [place('p-pa', '카페 A'), place('p-pb', '카페 B')] },
        { phrase: '식당', options: [place('p-pc', '식당 C'), place('p-pd', '식당 D')] },
        { phrase: '빵집', options: [place('p-pe', '빵집 E')] },
      ];
      await store.push(id, [
        o({ type: 'trip/create', trip: tripBody(id) }, 0),
        o({ type: 'chat/send', message: { id: 'msg-p', text: '카페랑 식당, 빵집' } }, 1, junho.id),
        o({ type: 'spot/extracted', messageId: 'msg-p', created: [], mergedSpotIds: [], ambiguous, highlights: [] }, 2, junho.id),
      ]);
      // 두 기기가 같은 '카페'를 서로 다른 곳으로 골랐다. 따로 도착해도 먼저 받은 것만 남는다(고른 상태가 push를 넘어 이어진다)
      await store.push(id, [o({ type: 'spot/resolveAmbiguous', messageId: 'msg-p', phrase: '카페', spot: spot('s-pa', 'p-pa', '카페 A') }, 3)]);
      await store.push(id, [o({ type: 'spot/resolveAmbiguous', messageId: 'msg-p', phrase: '카페', spot: spot('s-pb', 'p-pb', '카페 B') }, 4, junho.id)]);
      // 고르지 않음으로 닫은 항목, 없는 후보로 합치기, 추출 기록 없는 메시지는 받지 않는다
      await store.push(id, [
        o({ type: 'spot/resolveAmbiguous', messageId: 'msg-p', phrase: '식당', spot: null }, 5),
        o({ type: 'spot/resolveAmbiguous', messageId: 'msg-p', phrase: '식당', spot: spot('s-pc', 'p-pc', '식당 C') }, 6, junho.id),
        o({ type: 'spot/resolveAmbiguous', messageId: 'msg-p', phrase: '빵집', spot: null, mergeIntoSpotId: 'nope' }, 7),
        o({ type: 'spot/resolveAmbiguous', messageId: 'msg-none', phrase: '카페', spot: spot('s-px', 'p-px', '없는 메시지') }, 8),
      ]);
      await store.push(id, [o({ type: 'spot/resolveAmbiguous', messageId: 'msg-p', phrase: '빵집', spot: null, mergeIntoSpotId: 's-pa' }, 9, junho.id)]);
      const doc = foldOps((await store.pull(id, 0)) as unknown as Op[]);
      assert.ok(doc);
      const view = await store.readView(id);
      assert.deepEqual(view, viewOfDoc(doc));
      assert.deepEqual(view.spots.map((s) => [s.id, s.messageIds]), [['s-pa', ['msg-p']]]);
      assert.equal(await store.rebuildView(id), true);
      assert.deepEqual(await store.readView(id), view, '로그 전체로 다시 만들어도 같다');
    });

    test('방장이 아닌 사람의 기간 변경·방 삭제와 탈퇴한 방장의 편집은 표와 보관 기한에 옮기지 않는다(메모리 정리도 같다)', async () => {
      const mem = createSyncStore();
      const id = 'trip-hostonly';
      await pushBoth(mem, store, id, [
        op(id, { type: 'trip/create', trip: tripBody(id) }, T0),
        op(id, { type: 'trip/update', patch: { startDate: '2020-01-01', endDate: '2020-01-02' } }, T0 + 1000, 'm-stranger'),
        op(id, { type: 'trip/update', patch: { endDate: '2026-10-18' } }, T0 + 2000, junho.id),
        op(id, { type: 'trip/delete' }, T0 + 3000, junho.id),
      ]);
      await pushBoth(mem, store, id, [
        op(id, { type: 'member/anonymize', memberId: host.id }, T0 + 4000),
        op(id, { type: 'trip/update', patch: { endDate: '2026-10-20' } }, T0 + 5000),
      ]);
      const doc = foldOps((await store.pull(id, 0)) as unknown as Op[]);
      assert.ok(doc);
      const view = await store.readView(id);
      assert.deepEqual(view, viewOfDoc(doc));
      assert.deepEqual([view.trip?.startDate, view.trip?.endDate, view.trip?.deletedAt], ['2026-10-17', '2026-10-19', null]);
      const early = retentionUntil('2020-01-02') as number;
      assert.ok(!(await store.purgeExpired(early)).includes(id), '멤버 아닌 사람의 op 하나로 방이 지워지지 않는다');
      assert.ok(!mem.purgeExpired(early).includes(id));
      assert.equal(await count('trip_ops', id), 6);
    });

    test('조회용 표가 밀린 방은 보관 기한 정리 전에 로그로 다시 만든다. 다시 못 만들면 지난 표 값으로 판정하고 알린다', async () => {
      const mem = createSyncStore();
      const id = 'trip-restale';
      const at = (d: string) => atKst(d, '10:00');
      await pushBoth(mem, store, id, [op(id, { type: 'trip/create', trip: tripBody(id, '2024-12-10') }, at('2024-12-01'))]);
      const boundary = retentionUntil('2024-12-05') as number;
      await db.query("ALTER TABLE trips ADD CONSTRAINT yt_test_boom2 CHECK (end_date IS NULL OR end_date <> '2024-12-05')");
      warnings.length = 0;
      try {
        await pushBoth(mem, store, id, [op(id, { type: 'trip/update', patch: { startDate: '2024-12-05', endDate: '2024-12-05' } }, at('2024-12-02'))]);
        const row = (await db.query("SELECT view_stale, to_char(end_date, 'YYYY-MM-DD') AS end_date FROM trips WHERE trip_id = $1", [id])).rows[0];
        assert.deepEqual([row.view_stale, row.end_date], [true, '2024-12-10'], '표는 옛 종료일에 머물러 있다');
        assert.ok(!(await store.purgeExpired(boundary)).includes(id), '다시 못 만들면 지난 표 값(12-10)으로 판정한다');
        assert.ok(warnings.some((m) => m.includes('조회용 표 다시 만들기 실패(trip-restale)')));
      } finally {
        await db.query('ALTER TABLE trips DROP CONSTRAINT yt_test_boom2');
      }
      assert.ok((await store.purgeExpired(boundary)).includes(id), '로그로 다시 만든 종료일(12-05)로 판정해 지운다');
      assert.deepEqual(mem.purgeExpired(boundary), [id], '메모리 저장소는 로그를 접어 같은 판정을 한다');
      assert.equal(await count('trip_ops', id), 0);
    });

    test('생성 op 없는 방은 마지막으로 받은 뒤 365일이 지나면 지운다(메모리 저장소와 같다)', async () => {
      const mem = createSyncStore();
      const id = 'trip-orphan';
      const last = T0 + 7 * DAY_MS;
      await pushBoth(mem, store, id, [op(id, { type: 'chat/send', message: { id: 'orphan-1', text: '생성 op가 없다' } }, T0)], T0);
      await pushBoth(mem, store, id, [op(id, { type: 'chat/send', message: { id: 'orphan-2', text: '일주일 뒤' } }, last)], last);
      assert.ok(!(await store.purgeExpired(last + ORPHAN_RETENTION_MS - 1)).includes(id));
      assert.ok(!mem.purgeExpired(last + ORPHAN_RETENTION_MS - 1).includes(id));
      assert.ok((await store.purgeExpired(last + ORPHAN_RETENTION_MS)).includes(id));
      assert.deepEqual(mem.purgeExpired(last + ORPHAN_RETENTION_MS), [id]);
      assert.equal(await count('trip_ops', id), 0);
    });

    test('계정 탈퇴: 그 멤버 닉네임과 지운 사진의 주소·위치를 로그에서 가린다. 앱이 접은 문서는 가리기 전과 같다(메모리 저장소와 같다)', async () => {
      const mem = createSyncStore();
      const id = 'trip-withdraw';
      const t = (sec: number) => T0 + sec * 1000;
      const o = (body: OpBody, sec: number, actor: string) => op(id, body, t(sec), actor);
      const member = (mid: string, nickname: string, sec: number): Member => ({
        id: mid,
        userId: `u-${mid}`,
        nickname,
        role: 'member',
        isGuest: true,
        canInvite: false,
        joinedAt: t(sec),
      });
      const photo = (pid: string, memberId: string, sec: number, uri = `file:///photos/${pid}.jpg`): Photo => ({
        id: pid,
        memberId,
        uri,
        coord: { latitude: 35.8 + sec / 1000, longitude: 129.2 },
        spotId: 's-cafe',
        bytes: 1000,
        originalBytes: 1000,
        compressed: false,
        takenAt: t(sec),
        source: 'exif',
        uploadedAt: t(sec),
      });
      const sua = member('m-sua', '수아', 2);
      const dohyun = member('m-dohyun', '도현', 3);
      const long = member('m-long', '가나다라마바사아자차카타파', 4); // 13자: 앱이 거부하는 합류
      const all: Op[] = [];
      const send = async (ops: Op[]) => {
        const acks = await pushBoth(mem, store, id, ops);
        for (const x of ops) all.push({ ...x, seq: acks.find((a) => a.opId === x.id)?.seq });
      };
      await send([
        o({ type: 'trip/create', trip: tripBody(id) }, 0, host.id),
        o({ type: 'trip/issueInvite', invite: invite('WD00-0001', t(1)) }, 1, host.id),
        o({ type: 'member/join', member: sua, inviteCode: 'WD00-0001' }, 2, sua.id),
        o({ type: 'member/join', member: dohyun, inviteCode: 'WD00-0001' }, 3, dohyun.id),
        o({ type: 'member/join', member: long, inviteCode: 'WD00-0001' }, 4, long.id),
        o({ type: 'member/rename', memberId: sua.id, nickname: '수아짱' }, 5, sua.id),
        o({ type: 'journal/photoAdded', photo: photo('ph-sua-1', sua.id, 6) }, 6, sua.id),
        o({ type: 'journal/photoAdded', photo: photo('ph-sua-2', sua.id, 7) }, 7, sua.id),
        o({ type: 'journal/photoAdded', photo: photo('ph-sua-blob', sua.id, 8, 'blob:http://x/1') }, 8, sua.id), // 앱이 거부
        o({ type: 'journal/photoAdded', photo: photo('ph-junho', junho.id, 9) }, 9, junho.id),
        o({ type: 'journal/photoAdded', photo: photo('ph-dohyun', dohyun.id, 10) }, 10, dohyun.id),
        o({ type: 'chat/send', message: { id: 'msg-wd', text: '여기 가 보자' } }, 11, sua.id),
      ]);
      // 남이 보낸 탈퇴·사진 삭제는 앱이 거부한다. 가리지 않는다
      await send([o({ type: 'member/anonymize', memberId: dohyun.id }, 12, host.id), o({ type: 'journal/photoRemoved', photoId: 'ph-dohyun' }, 13, host.id)]);
      // 수아 탈퇴(사진 하나만 지운다), 준호 탈퇴, 합류를 거부당한 사람의 탈퇴
      await send([
        o({ type: 'journal/photoRemoved', photoId: 'ph-sua-1' }, 14, sua.id),
        o({ type: 'journal/photoRemoved', photoId: 'ph-sua-blob' }, 15, sua.id),
        o({ type: 'member/anonymize', memberId: sua.id }, 16, sua.id),
      ]);
      await send([o({ type: 'journal/photoRemoved', photoId: 'ph-junho' }, 17, junho.id), o({ type: 'member/anonymize', memberId: junho.id }, 18, junho.id)]);
      await send([o({ type: 'member/anonymize', memberId: long.id }, 19, long.id)]);
      // 탈퇴 뒤에 늦게 도착한 다른 기기의 이름 바꾸기도 받을 때 가린다
      await send([o({ type: 'member/rename', memberId: sua.id, nickname: '늦은수아' }, 20, sua.id)]);

      const pulled = await store.pull(id, 0);
      assert.deepEqual(pulled, mem.pull(id, 0), '메모리 저장소와 같다');
      assert.equal(await count('trip_ops', id), all.length, '로그 행은 그대로다');
      const text = JSON.stringify(pulled);
      for (const s of ['수아', '준호', long.nickname, 'ph-sua-1.jpg', 'ph-junho.jpg', 'blob:']) assert.ok(!text.includes(s), `${s}는 가린다`);
      for (const s of ['민지', '도현', 'ph-sua-2.jpg', 'ph-dohyun.jpg']) assert.ok(text.includes(s), `${s}는 남는다`);
      const removed = pulled.find((x) => (x as { photo?: Photo }).photo?.id === 'ph-sua-1') as unknown as { photo: Photo };
      assert.deepEqual(
        removed.photo,
        { id: 'ph-sua-1', memberId: sua.id, bytes: 1000, originalBytes: 1000, compressed: false, takenAt: t(6), source: 'exif', uploadedAt: t(6) },
        '주소·위치·스팟을 뺀다',
      );

      const before = foldOps(all);
      const after = foldOps(pulled as unknown as Op[]);
      assert.ok(before && after);
      assert.deepEqual(after, before, '앱이 접은 문서는 가리기 전과 같다');
      assert.deepEqual(
        before.members.map((m) => [m.id, m.nickname]),
        [
          [host.id, '민지'],
          [junho.id, '탈퇴한 멤버'],
          [sua.id, '탈퇴한 멤버'],
          [dohyun.id, '도현'],
        ],
      );
      assert.deepEqual(before.photos.map((p) => p.id), ['ph-sua-2', 'ph-dohyun']);
    });

    test(
      'openPostgresStore: 실제 드라이버(pg.Pool)로 붙어 마이그레이션·push·pull·health·close까지 된다',
      { skip: backend.real ? false : '연결 문자열이 있는 실제 PostgreSQL에서만 돈다' },
      async () => {
        const real = await openPostgresStore(opened.url as string, { warn: (m) => warnings.push(m) });
        try {
          assert.equal(real.kind, 'postgres');
          const id = 'trip-driver';
          const create = op(id, { type: 'trip/create', trip: tripBody(id) }, T0);
          assert.deepEqual(await real.push(id, [create]), [{ opId: create.id, seq: 1 }]);
          assert.deepEqual(await real.pull(id, 0), [{ ...create, seq: 1 }]);
          assert.equal(await real.health(), true);
          assert.equal(await count('trips', id), 1, '테스트 스키마에 썼다');
        } finally {
          await real.close();
        }
      },
    );

    test('health는 true이고, reset은 여행방 표를 비운다(경로 캐시는 남긴다)', async () => {
      assert.equal(await store.health(), true);
      await store.routeCache.put('keep', { ok: 1 }, T0);
      await store.reset();
      for (const table of ['trips', 'trip_ops', 'invite_codes', 'trip_spots', 'trip_days', 'trip_legs']) {
        assert.equal((await db.query(`SELECT count(*)::int AS c FROM ${table}`)).rows[0].c, 0, table);
      }
      assert.deepEqual(await store.routeCache.get('keep', T0 + 1), { ok: 1 });
      const again = op('trip-seq', { type: 'trip/create', trip: tripBody('trip-seq') }, T0);
      assert.deepEqual(await store.push('trip-seq', [again]), [{ opId: again.id, seq: 1 }], '리셋 뒤 seq는 1부터');
    });
  });
}

for (const backend of BACKENDS) {
  describe(`HTTP 서버 + PostgreSQL 저장소(${backend.name})`, { skip: backend.skip }, () => {
    let opened: Opened;
    let store: PostgresSyncStore;
    let now = T0 + 10_000;
    const fetchLike: FetchLike = (url, init) => fetch(url, init);

    before(async () => {
      opened = await backend.open();
      await migrate(opened.db);
      store = createPostgresStore(opened.db, { warn: () => {} });
    });
    after(async () => {
      await opened?.close();
    });

    test('/health는 {ok, db}를 준다. 메모리 서버는 db가 memory다', async () => {
      const server = await startSyncServer({ store, now: () => now, purgeEveryMs: 0 });
      const memServer = await startSyncServer({ purgeEveryMs: 0 });
      try {
        const res = await fetch(`${server.url}/health`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('access-control-allow-origin'), '*');
        assert.deepEqual(await res.json(), { ok: true, db: 'postgres' });
        assert.deepEqual(await (await fetch(`${memServer.url}/health`)).json(), { ok: true, db: 'memory' });
      } finally {
        await server.close();
        await memServer.close();
      }
    });

    test('앱 HTTP 전송으로 push·pull·구독·초대 조회·reset(허용했을 때)이 그대로 된다', async () => {
      const server = await startSyncServer({ store, now: () => now, purgeEveryMs: 0, allowReset: true });
      const t = createHttpTransport({ url: server.url, fetch: fetchLike, clock: { now: () => now }, pollMs: 20 });
      try {
        const create = op('trip-h', { type: 'trip/create', trip: tripBody('trip-h') }, T0);
        const a = op('trip-h', { type: 'trip/setDay', date: '2026-10-18', patch: { noReturn: true } }, T0 + 1000);
        assert.deepEqual(await t.push([create, a]), [{ opId: create.id, seq: 1 }, { opId: a.id, seq: 2 }]);
        assert.deepEqual(await t.push([a]), [{ opId: a.id, seq: 2 }]);
        assert.deepEqual((await t.pull('trip-h', 1)).map((o) => o.id), [a.id]);
        assert.equal(foldOps(await t.pull('trip-h', 0))?.days.find((d) => d.date === '2026-10-18')?.noReturn, true);

        const got: Op[] = [];
        const off = t.subscribe('trip-h', (ops) => got.push(...ops));
        await t.push([op('trip-h', { type: 'trip/issueInvite', invite: invite('HTTP-0001', T0 + 3000) }, T0 + 3000)]);
        for (let i = 0; i < 50 && got.length < 3; i += 1) await new Promise((r) => setTimeout(r, 20));
        off();
        assert.deepEqual([...new Set(got.map((o) => o.seq))].sort(), [1, 2, 3]);

        const ok = await t.lookupInvite('HTTP-0001');
        assert.ok('trip' in ok && ok.trip.id === 'trip-h');
        assert.deepEqual(await t.lookupInvite('NONE-0000'), { error: 'notFound' });
        const bad = await fetch(`${server.url}/trips/trip-h/ops`, { method: 'POST', body: '{"ops":1}' });
        assert.equal(bad.status, 400);
        await t.reset();
        assert.deepEqual(await t.pull('trip-h', 0), []);
      } finally {
        await server.close();
      }
    });

    test('시연 리셋: PostgreSQL 저장소는 기본으로 403이고 아무것도 지우지 않는다(앱은 실패를 무시한다). allowReset이면 204', async () => {
      const id = 'trip-keepreset';
      await store.push(id, [op(id, { type: 'trip/create', trip: tripBody(id) }, T0)]);
      const locked = await startSyncServer({ store, now: () => now, purgeEveryMs: 0 });
      const open = await startSyncServer({ store, now: () => now, purgeEveryMs: 0, allowReset: true });
      try {
        const res = await fetch(`${locked.url}/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(res.status, 403);
        assert.deepEqual(await res.json(), { error: 'resetDisabled' });
        assert.equal((await store.pull(id, 0)).length, 1, '데이터가 남는다');
        await createHttpTransport({ url: locked.url, fetch: fetchLike, clock: { now: () => now } }).reset();
        assert.equal((await store.pull(id, 0)).length, 1, '앱 시연 리셋도 서버 데이터를 지우지 않는다');
        assert.equal((await fetch(`${open.url}/reset`, { method: 'POST', body: '{}' })).status, 204);
        assert.deepEqual(await store.pull(id, 0), []);
      } finally {
        await locked.close();
        await open.close();
      }
    });

    test('경로의 tripId가 키로 못 쓰는 값이면 400, 그런 초대 코드는 notFound다', async () => {
      const server = await startSyncServer({ store, now: () => now, purgeEveryMs: 0 });
      try {
        assert.equal((await fetch(`${server.url}/trips/a%00b/ops?after=0`)).status, 400);
        const long = await fetch(`${server.url}/trips/${'y'.repeat(201)}/ops`, { method: 'POST', body: JSON.stringify({ ops: [] }) });
        assert.equal(long.status, 400);
        const inv = await fetch(`${server.url}/invites/BAD%00`);
        assert.equal(inv.status, 200);
        assert.deepEqual(await inv.json(), { error: 'notFound' });
      } finally {
        await server.close();
      }
    });

    test('보관 기한 정리는 시작할 때 한 번 돌고, 그 뒤 주기마다 돈다', async () => {
      const logs: string[] = [];
      await store.push('trip-gone', [op('trip-gone', { type: 'trip/create', trip: tripBody('trip-gone', '2025-01-10') }, T0)]);
      await store.push('trip-later', [op('trip-later', { type: 'trip/create', trip: tripBody('trip-later', '2025-01-11') }, T0)]);
      now = retentionUntil('2025-01-10') as number;
      const server = await startSyncServer({ store, now: () => now, purgeEveryMs: 15, log: (m) => logs.push(m) });
      try {
        assert.deepEqual(await store.pull('trip-gone', 0), [], '시작 전에 지웠다');
        assert.equal((await store.pull('trip-later', 0)).length, 1);
        now += DAY_MS;
        for (let i = 0; i < 100 && (await store.pull('trip-later', 0)).length > 0; i += 1) await new Promise((r) => setTimeout(r, 15));
        assert.deepEqual(await store.pull('trip-later', 0), [], '주기 정리로 지웠다');
        assert.ok(logs.filter((m) => m.startsWith('보관 기한 정리: 여행방 1개 삭제')).length >= 2);
      } finally {
        await server.close();
        now = T0 + 10_000;
      }
    });

    test('저장소 오류는 500, 본문 오류는 400이다(앱은 둘 다 다시 보낸다)', async () => {
      const broken: SyncStore = {
        ...createSyncStore(),
        push: () => Promise.reject(new Error('connection terminated')),
        health: () => false,
      };
      const logs: string[] = [];
      const server = await startSyncServer({ store: broken, purgeEveryMs: 0, log: (m) => logs.push(m) });
      try {
        const res = await fetch(`${server.url}/trips/x/ops`, { method: 'POST', body: JSON.stringify({ ops: [] }) });
        assert.equal(res.status, 500);
        assert.deepEqual(await res.json(), { error: 'serverError' });
        assert.match(logs[0], /connection terminated/);
        assert.equal((await fetch(`${server.url}/trips/x/ops`, { method: 'POST', body: 'not json' })).status, 400);
        const health = await fetch(`${server.url}/health`);
        assert.equal(health.status, 503);
        assert.deepEqual(await health.json(), { ok: false, db: 'memory' });
      } finally {
        await server.close();
      }
    });
  });
}

describe('시작 설정', () => {
  test('DATABASE_URL이 없거나 비었으면 메모리 저장소다', async () => {
    assert.equal((await storeFromEnv({})).kind, 'memory');
    assert.equal((await storeFromEnv({ DATABASE_URL: '  ' })).kind, 'memory');
  });

  test('DATABASE_URL이 있는데 붙지 못하면 던진다(메모리로 바꾸지 않는다). 연결 풀은 닫고 주소는 문구에 넣지 않는다', async () => {
    let ended = 0;
    const url = 'postgresql://youngtrip:secret-pw@127.0.0.1:5432/youngtrip';
    const fakePool = {
      query: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
      connect: () => Promise.reject(new Error('unused')),
      end: async () => {
        ended += 1;
      },
      on: () => {},
    };
    const open = (u: string) => openPostgresStore(u, { createPool: () => fakePool, warn: () => {} });
    await assert.rejects(storeFromEnv({ DATABASE_URL: url }, { openPostgres: open }), (e: Error) => {
      assert.match(e.message, /PostgreSQL에 연결하지 못했습니다/);
      assert.match(e.message, /ECONNREFUSED/);
      assert.doesNotMatch(e.message, /secret-pw/);
      return true;
    });
    assert.equal(ended, 1);
  });

  test('붙은 뒤 마이그레이션이 실패해도 던진다', async () => {
    let ended = 0;
    const client = {
      query: async (text: string) => {
        if (text.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations')) throw new Error('permission denied for schema public');
        return { rows: [] };
      },
      release: () => {},
    };
    const fakePool = {
      query: async () => ({ rows: [{ '?column?': 1 }] }),
      connect: async () => client,
      end: async () => {
        ended += 1;
      },
    };
    await assert.rejects(openPostgresStore('postgresql://x', { createPool: () => fakePool, warn: () => {} }), /마이그레이션에 실패했습니다: permission denied/);
    assert.equal(ended, 1);
  });

  test('sqlDb(pg.Pool): 트랜잭션은 한 연결에서 BEGIN·COMMIT, 실패하면 ROLLBACK하고 연결을 돌려준다', async () => {
    const log: string[] = [];
    const pool = {
      query: async (text: string) => {
        log.push(`pool:${text}`);
        return { rows: [] };
      },
      connect: async () => ({
        query: async (text: string) => {
          log.push(text);
          if (text === 'BOOM') throw new Error('boom');
          return { rows: [{ ok: 1 }] };
        },
        release: (err?: Error) => log.push(`release:${err ? 'broken' : 'ok'}`),
      }),
    };
    const db = sqlDb(pool);
    assert.equal(await db.tx(async (q) => (await q.query('SELECT 1')).rows[0].ok), 1);
    assert.deepEqual(log, ['BEGIN', 'SELECT 1', 'COMMIT', 'release:ok']);
    log.length = 0;
    await assert.rejects(db.tx((q) => q.exec('BOOM')), /boom/);
    assert.deepEqual(log, ['BEGIN', 'BOOM', 'ROLLBACK', 'release:ok']);
    log.length = 0;
    await db.query('SELECT 2');
    assert.deepEqual(log, ['pool:SELECT 2'], '트랜잭션 밖 쿼리는 풀에 바로 간다');
  });

  test('시연 리셋은 메모리 저장소면 늘 허용하고, PostgreSQL은 SYNC_ALLOW_RESET=1일 때만 허용한다', () => {
    assert.equal(allowResetFromEnv({}, 'memory'), true);
    assert.equal(allowResetFromEnv({}, 'postgres'), false);
    assert.equal(allowResetFromEnv({ SYNC_ALLOW_RESET: '0' }, 'postgres'), false);
    assert.equal(allowResetFromEnv({ SYNC_ALLOW_RESET: ' 1 ' }, 'postgres'), true);
  });

  test('sqlDb는 pg.Pool·PGlite 모양이 아니면 거부한다', () => {
    assert.throws(() => sqlDb({}), /pg\.Pool 또는 PGlite/);
  });
});

describe('조회용 표 계산(순수)', () => {
  test('보관 기한은 앱 계산(tripStatus.retentionUntil)과 같고, 종료일이 없으면 지우지 않는다', () => {
    for (const end of ['2026-10-19', '2025-03-01', '2024-02-29', '2026-12-31', '2027-01-01']) {
      assert.equal(retentionUntil(end), appRetentionUntil({ endDate: end }), end);
    }
    assert.equal(retentionUntil(undefined), null);
    assert.equal(retentionUntil('2026-02-30'), null);
    assert.equal(retentionUntil('9998-12-30'), appRetentionUntil({ endDate: '9998-12-30' }));
    assert.equal(retentionUntil('9999-12-31'), null, '기한이 서버가 다루는 시각을 넘으면 종료일로는 지우지 않는다');
    const mem = createSyncStore();
    mem.push('no-create', [op('no-create', { type: 'trip/setDay', date: '2026-10-18', patch: { noReturn: true } }, T0)], T0);
    assert.deepEqual(mem.purgeExpired(T0 + ORPHAN_RETENTION_MS - 1), [], '생성 op가 없는 방은 종료일을 몰라 마지막으로 받은 뒤 365일까지 남긴다');
    assert.deepEqual(mem.purgeExpired(T0 + ORPHAN_RETENTION_MS), ['no-create']);
  });

  test('메모리 보관 기한 정리는 로그를 접다 실패한 방만 건너뛰고 나머지 방은 지운다', () => {
    const warns: string[] = [];
    const mem = createSyncStore({ warn: (m) => warns.push(m) });
    const old = 'trip-mem-old';
    mem.push(old, [op(old, { type: 'trip/create', trip: tripBody(old, '2024-10-19') }, T0)], T0);
    const broken: Record<string, unknown> = { ...op('trip-mem-bad', { type: 'trip/create', trip: tripBody('trip-mem-bad') }, T0) };
    broken.trip = {
      get title(): string {
        throw new Error('접을 수 없는 값');
      },
    };
    mem.push('trip-mem-bad', [broken], T0);
    assert.deepEqual(mem.purgeExpired(retentionUntil('2024-10-19') as number), [old]);
    assert.equal(mem.pull('trip-mem-bad', 0).length, 1, '실패한 방은 남긴다');
    assert.match(warns[0], /보관 기한 판정 실패\(trip-mem-bad\).*접을 수 없는 값/);
  });

  test('계정 탈퇴 가리기는 앱과 같은 상수를 쓰고, 이미 가린 로그는 더 바꾸지 않는다', () => {
    assert.equal(DELETED_MEMBER_NAME, APP_DELETED_MEMBER_NAME);
    assert.equal(NICKNAME_MAX, APP_NICKNAME_MAX);
    const id = 'trip-redact';
    const log = [
      { ...op(id, { type: 'trip/create', trip: tripBody(id) }, T0), seq: 1 },
      { ...op(id, { type: 'member/anonymize', memberId: junho.id }, T0 + 1000, junho.id), seq: 2 },
    ];
    const first = redactLog(log);
    assert.deepEqual([...first.keys()], [0]);
    const masked = log.map((x, i) => first.get(i) ?? x);
    const created = masked[0] as unknown as { trip: Trip };
    assert.deepEqual(created.trip.members.map((m) => m.nickname), ['민지', '탈퇴한 멤버']);
    assert.equal(redactLog(masked).size, 0);
  });

  test('로그 전체를 접은 결과는 한 op씩 더한 결과와 같다', () => {
    const id = 'trip-pure';
    const ops = [
      op(id, { type: 'trip/create', trip: tripBody(id) }, T0),
      op(id, { type: 'spot/add', spot: spot('p1', 'p-p1', '오릉') }, T0 + 1000),
      op(id, { type: 'schedule/setStay', spotId: 'p1', stayMin: 45 }, T0 + 2000),
      op(id, { type: 'trip/update', patch: { startDate: '2026-10-18' } }, T0 + 3000),
    ];
    const step = emptyView();
    for (const o of ops) projectOps([o], step);
    const whole = projectOps(ops);
    assert.deepEqual(whole, step);
    assert.deepEqual([...whole.days.keys()], ['2026-10-18', '2026-10-19'], '기간이 줄면 기간 밖 날짜를 버린다');
    assert.equal(whole.spots.get('p1')?.stayMin, 45);
  });
});
