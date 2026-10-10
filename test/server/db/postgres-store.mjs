/**
 * PostgreSQL 저장소(WP2 소유). 메모리 저장소(sync-server.mjs createSyncStore)와 같은 일을 하고 결과 모양도 같다.
 * 운영은 pg.Pool, 테스트는 PGlite(WASM Postgres)로 같은 SQL을 돌린다. 둘 다 query(text, params) → {rows}라
 * sqlDb()가 트랜잭션 모양만 맞춘다.
 *
 * push 한 번 = 트랜잭션 한 번:
 *   1. trips 행을 만들거나 잠근다(INSERT … ON CONFLICT DO UPDATE). 같은 방 push는 여기서 줄을 선다
 *   2. 이미 받은 op id는 처음 seq로 확인 응답만 한다. 새 op는 last_seq 다음 번호를 매겨 trip_ops에 넣는다
 *   3. 초대 발급 op는 invite_codes 색인에 적는다. 계정 탈퇴·사진 삭제 op가 오면 로그 본문에서 그 닉네임과 사진 주소·위치를 가린다
 *   4. 조회용 표(trips 요약, trip_spots, trip_days, trip_legs)를 새 op만큼 갱신한다(server/db/projection.mjs).
 *      이 단계는 SAVEPOINT 안에서 돈다. 실패하면 되돌리고 view_stale을 켜 둔 채 로그 저장은 그대로 커밋한다.
 *      다음 push나 보관 기한 정리가 그 방 표를 로그 전체로 다시 만든다. 조회용 표 때문에 동기화가 막히지 않는다.
 *
 * jsonb는 NUL 문자와 짝 없는 서로게이트를 받지 않는다. 그런 글자는 값이든 객체 키든 U+FFFD로 바꿔 저장한다
 * (계정 탈퇴 가리기와 함께, 받은 그대로 돌려주지 않는 두 경우다). tripId·op.id·초대 코드처럼 키로 쓰는 값은 바꾸지 않고, 못 쓰는 값이면
 * 그 op나 색인을 건너뛴다(server/ids.mjs. 메모리 저장소도 같다).
 */
import { storableId } from '../ids.mjs';
import { INVITE_OP_TYPES, lookupInTrips } from '../invites.mjs';
import { NICKNAME_OP_TYPES, REDACT_TRIGGER_TYPES, redactLog } from '../redact.mjs';
import { ORPHAN_RETENTION_MS, ROUTE_CACHE_TTL_MS, retentionUntil } from '../retention.mjs';
import { createPgAuthStore } from './auth-store.mjs';
import { migrate } from './migrate.mjs';
import { emptyView, legKey, projectOps } from './projection.mjs';

const INT4_MAX = 2_147_483_647;

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const msOf = (v) => (v == null ? null : v instanceof Date ? v.getTime() : Date.parse(v));

/** 짝 없는 서로게이트와 NUL을 U+FFFD로 바꾼 글자 */
function cleanText(v) {
  const ok = v.isWellFormed() ? v : v.toWellFormed();
  return ok.includes('\u0000') ? ok.replaceAll('\u0000', '\uFFFD') : ok;
}

/** jsonb에 넣을 수 있는 JSON 문자열. 문자열 값과 객체 키의 NUL·짝 없는 서로게이트를 U+FFFD로 바꾼다. */
export function jsonText(value) {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'string') return cleanText(v);
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some((k) => cleanText(k) !== k)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [cleanText(k), x]));
    }
    return v;
  });
}

const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

/** 키 순서를 고정한 JSON(바뀐 행만 쓰려고 비교할 때 쓴다) */
function sortedJson(obj) {
  return JSON.stringify(Object.fromEntries(Object.entries(obj ?? {}).sort(byKey)));
}

/** 계산 전용 상태(trips.view_state). 키 순서를 고정해 비교한다. */
function stateJson(view) {
  const picks = [...view.picks].sort(byKey).map(([m, p]) => [m, Object.fromEntries([...p].sort(byKey))]);
  return JSON.stringify({ hosts: [...view.hosts].sort(), picks: Object.fromEntries(picks) });
}

/**
 * pg.Pool 또는 PGlite를 {query, tx}로 감싼다. tx(fn)의 fn은 {query, exec}를 받는다(exec는 여러 문장 SQL).
 * PGlite는 연결이 하나라 transaction()이 그동안 다른 쿼리를 기다리게 한다.
 */
export function sqlDb(client) {
  if (typeof client?.transaction === 'function' && typeof client.exec === 'function') {
    return {
      query: (text, params) => client.query(text, params),
      tx: (fn) => client.transaction((t) => fn({ query: (text, params) => t.query(text, params), exec: (sql) => t.exec(sql) })),
    };
  }
  if (typeof client?.connect === 'function' && typeof client.query === 'function') {
    return {
      query: (text, params) => client.query(text, params),
      async tx(fn) {
        const c = await client.connect();
        let broken;
        try {
          await c.query('BEGIN');
          const out = await fn({ query: (text, params) => c.query(text, params), exec: (sql) => c.query(sql) });
          await c.query('COMMIT');
          return out;
        } catch (e) {
          await c.query('ROLLBACK').catch((err) => {
            broken = err;
          });
          throw e;
        } finally {
          c.release(broken);
        }
      },
    };
  }
  throw new Error('sqlDb: pg.Pool 또는 PGlite가 필요합니다');
}

/* ---------- 조회용 표 읽고 쓰기 ---------- */

const TRIP_COLS = [
  'created',
  'title',
  'region',
  'start_date',
  'end_date',
  'transport',
  'day_start',
  'day_end',
  'created_by',
  'created_at',
  'deleted_at',
  'invite_code',
  'invite_issued_at',
  'invite_expires_at',
  'invite_capacity',
  'invite_revoked_at',
  'retain_until',
];
/** trips 행에서 읽고 쓰는 열: 요약 열 + 계산 전용 상태 */
const TRIP_ROW = [...TRIP_COLS, 'view_state'];
const SPOT_COLS = [
  'trip_id',
  'spot_id',
  'place_id',
  'name',
  'category',
  'kind',
  'lat',
  'lng',
  'address',
  'pinned',
  'stay_min',
  'fixed_date',
  'manual_date',
  'manual_index',
  'arrive_override',
  'removed',
  'removed_reason',
  'message_ids',
  'manual',
  'created_at',
  'edited',
];
const DAY_COLS = [
  'trip_id',
  'trip_date',
  'base_mode',
  'base_name',
  'base_lat',
  'base_lng',
  'base_place_id',
  'no_return',
  'day_start',
  'day_end',
  'transport',
  'edited',
];
const LEG_COLS = ['trip_id', 'trip_date', 'from_id', 'to_id', 'transport', 'cleared', 'edited_at'];

const DATE_COLS = new Set(['start_date', 'end_date', 'trip_date', 'fixed_date', 'manual_date']);
/** date 열은 'YYYY-MM-DD' 글자로 읽는다(드라이버마다 date를 다른 시간대의 Date로 바꾼다). */
const select = (cols) => cols.map((c) => (DATE_COLS.has(c) ? `to_char(${c}, 'YYYY-MM-DD') AS ${c}` : c)).join(', ');

function upsertSql(table, cols, keys) {
  const set = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = EXCLUDED.${c}`);
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
    ON CONFLICT (${keys.join(', ')}) DO UPDATE SET ${set.join(', ')}`;
}

const TABLES = {
  spots: { table: 'trip_spots', cols: SPOT_COLS, keys: ['trip_id', 'spot_id'] },
  days: { table: 'trip_days', cols: DAY_COLS, keys: ['trip_id', 'trip_date'] },
  legs: { table: 'trip_legs', cols: LEG_COLS, keys: ['trip_id', 'trip_date', 'from_id', 'to_id'] },
};
for (const t of Object.values(TABLES)) {
  t.upsert = upsertSql(t.table, t.cols, t.keys);
  t.remove = `DELETE FROM ${t.table} WHERE ${t.keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ')}`;
}

function tripParams(t) {
  if (!t) return [false, ...TRIP_COLS.slice(1).map(() => null)];
  const inv = t.invite;
  return [
    true,
    t.title,
    t.region,
    t.startDate,
    t.endDate,
    t.transport,
    t.dayStart,
    t.dayEnd,
    t.createdBy,
    iso(t.createdAt),
    iso(t.deletedAt),
    inv?.code ?? null,
    iso(inv?.issuedAt),
    iso(inv?.expiresAt),
    inv?.capacity ?? null,
    iso(inv?.revokedAt),
    iso(retentionUntil(t.endDate)),
  ];
}

const spotParams = (tripId, s) => [
  tripId,
  s.id,
  s.placeId,
  s.name,
  s.category,
  s.kind,
  s.lat,
  s.lng,
  s.address,
  s.pinned,
  s.stayMin,
  s.fixedDate,
  s.manualDate,
  s.manualIndex,
  s.arriveOverride,
  s.removed,
  s.removedReason,
  [...s.messageIds], // 복사한다. 갱신 전 행과 비교할 때 같은 배열을 보면 바뀐 것을 놓친다
  s.manual,
  iso(s.createdAt),
  sortedJson(s.edited),
];
const dayParams = (tripId, d) => [
  tripId,
  d.date,
  d.baseMode,
  d.baseName,
  d.baseLat,
  d.baseLng,
  d.basePlaceId,
  d.noReturn,
  d.dayStart,
  d.dayEnd,
  d.transport,
  sortedJson(d.edited),
];
const legParams = (tripId, l) => [tripId, l.date, l.fromId, l.toId, l.transport, l.cleared, l.at];

/** 조회 상태 → 표 행(매개변수 배열). 비교용 JSON도 같이 둔다. */
function viewRows(tripId, view) {
  const rows = (map, fn) => new Map([...map].map(([k, v]) => [k, fn(tripId, v)]));
  return {
    trip: [...tripParams(view.trip), stateJson(view)],
    spots: rows(view.spots, spotParams),
    days: rows(view.days, dayParams),
    legs: rows(view.legs, legParams),
  };
}

async function loadView(q, tripId) {
  const view = emptyView();
  const t = (await q.query(`SELECT ${select(TRIP_ROW)} FROM trips WHERE trip_id = $1`, [tripId])).rows[0];
  const state = t?.view_state ?? {};
  view.hosts = new Set(Array.isArray(state.hosts) ? state.hosts : []);
  view.picks = new Map(Object.entries(state.picks ?? {}).map(([m, p]) => [m, new Map(Object.entries(p ?? {}))]));
  if (t?.created) {
    view.trip = {
      title: t.title,
      region: t.region,
      startDate: t.start_date,
      endDate: t.end_date,
      transport: t.transport,
      dayStart: t.day_start,
      dayEnd: t.day_end,
      createdBy: t.created_by,
      createdAt: msOf(t.created_at),
      deletedAt: msOf(t.deleted_at),
      invite:
        t.invite_code == null
          ? null
          : {
              code: t.invite_code,
              issuedAt: msOf(t.invite_issued_at),
              expiresAt: msOf(t.invite_expires_at),
              capacity: t.invite_capacity,
              revokedAt: msOf(t.invite_revoked_at),
            },
    };
  }
  const read = async (k, order) =>
    (await q.query(`SELECT ${select(TABLES[k].cols)} FROM ${TABLES[k].table} WHERE trip_id = $1 ORDER BY ${order}`, [tripId])).rows;
  for (const r of await read('spots', 'spot_id')) {
    view.spots.set(r.spot_id, {
      id: r.spot_id,
      placeId: r.place_id,
      name: r.name,
      category: r.category,
      kind: r.kind,
      lat: r.lat,
      lng: r.lng,
      address: r.address,
      pinned: r.pinned,
      stayMin: r.stay_min,
      fixedDate: r.fixed_date,
      manualDate: r.manual_date,
      manualIndex: r.manual_index,
      arriveOverride: r.arrive_override,
      removed: r.removed,
      removedReason: r.removed_reason,
      messageIds: [...(r.message_ids ?? [])],
      manual: r.manual,
      createdAt: msOf(r.created_at),
      edited: { ...r.edited },
    });
  }
  for (const r of await read('days', 'trip_date')) {
    view.days.set(r.trip_date, {
      date: r.trip_date,
      baseMode: r.base_mode,
      baseName: r.base_name,
      baseLat: r.base_lat,
      baseLng: r.base_lng,
      basePlaceId: r.base_place_id,
      noReturn: r.no_return,
      dayStart: r.day_start,
      dayEnd: r.day_end,
      transport: r.transport,
      edited: { ...r.edited },
    });
  }
  for (const r of await read('legs', 'trip_date, from_id, to_id')) {
    view.legs.set(legKey(r.trip_date, r.from_id, r.to_id), {
      date: r.trip_date,
      fromId: r.from_id,
      toId: r.to_id,
      transport: r.transport,
      at: r.edited_at == null ? null : Number(r.edited_at),
      cleared: r.cleared,
    });
  }
  return view;
}

/** 바뀐 행만 쓴다. 없어진 행은 지운다. */
async function saveView(q, tripId, before, after) {
  if (JSON.stringify(before.trip) !== JSON.stringify(after.trip)) {
    const set = TRIP_ROW.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await q.query(`UPDATE trips SET ${set} WHERE trip_id = $1`, [tripId, ...after.trip]);
  }
  for (const k of Object.keys(TABLES)) {
    const { upsert, remove, keys } = TABLES[k];
    for (const [key, row] of before[k]) {
      if (!after[k].has(key)) await q.query(remove, row.slice(0, keys.length));
    }
    for (const [key, row] of after[k]) {
      const prev = before[k].get(key);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(row)) await q.query(upsert, row);
    }
  }
}

/**
 * 계정 탈퇴 가리기(server/redact.mjs). 이번에 받은 op 종류에 필요한 종류만 읽어 가리고, 바뀐 본문만 고쳐 쓴다.
 * 사진 삭제가 오면 사진 op를, 탈퇴·닉네임 op가 오면 닉네임 op와 탈퇴 op를 읽는다.
 */
async function redactStored(q, tripId, entries) {
  const types = new Set();
  for (const e of entries) {
    if (e.type === 'journal/photoRemoved') types.add('journal/photoAdded').add('journal/photoRemoved');
    else if (REDACT_TRIGGER_TYPES.includes(e.type)) for (const t of [...NICKNAME_OP_TYPES, 'member/anonymize']) types.add(t);
  }
  if (types.size === 0) return;
  const { rows } = await q.query('SELECT seq, body FROM trip_ops WHERE trip_id = $1 AND type = ANY($2::text[]) ORDER BY seq', [tripId, [...types]]);
  for (const [i, masked] of redactLog(rows.map((r) => r.body))) {
    await q.query('UPDATE trip_ops SET body = $3::jsonb WHERE trip_id = $1 AND seq = $2', [tripId, rows[i].seq, jsonText(masked)]);
  }
}

async function logOf(q, tripId) {
  return (await q.query('SELECT body FROM trip_ops WHERE trip_id = $1 ORDER BY seq', [tripId])).rows.map((r) => r.body);
}

/** 그 방 조회용 표를 갱신한다. fresh가 null이면 로그 전체로 다시 만든다. 실패하면 던진다. */
async function refresh(q, tripId, fresh) {
  const current = await loadView(q, tripId);
  const before = viewRows(tripId, current);
  const next = fresh ? projectOps(fresh, current) : projectOps(await logOf(q, tripId));
  await saveView(q, tripId, before, viewRows(tripId, next));
  if (!fresh) await q.query('UPDATE trips SET view_stale = false WHERE trip_id = $1', [tripId]);
}

/* ---------- 저장소 ---------- */

/**
 * db: sqlDb()로 감싼 연결. 마이그레이션은 부르는 쪽이 먼저 돌린다(openPostgresStore가 한다).
 * close: 저장소를 닫을 때 부른다(연결 풀 정리). warn: 조회용 표 갱신 실패 같은 경고를 받는다.
 */
export function createPostgresStore(db, { close = async () => {}, warn = (m) => console.warn(m) } = {}) {
  return {
    kind: 'postgres',
    /** 계정·로그인 표(auth_*). 같은 DB를 쓴다(server/auth.mjs) */
    authStore: createPgAuthStore(db),

    async push(tripId, ops, now = Date.now()) {
      if (!storableId(tripId)) return [];
      const list = (Array.isArray(ops) ? ops : []).filter((op) => op && storableId(op.id) && op.tripId === tripId);
      if (list.length === 0) return [];
      const at = iso(now);
      return db.tx(async (q) => {
        const room = (
          await q.query(
            `INSERT INTO trips (trip_id, first_received_at, last_received_at) VALUES ($1, $2, $2)
             ON CONFLICT (trip_id) DO UPDATE SET last_received_at = EXCLUDED.last_received_at
             RETURNING last_seq, view_stale`,
            [tripId, at],
          )
        ).rows[0];
        const ids = [...new Set(list.map((op) => op.id))];
        const known = new Map(
          (await q.query('SELECT op_id, seq FROM trip_ops WHERE trip_id = $1 AND op_id = ANY($2::text[])', [tripId, ids])).rows.map((r) => [
            r.op_id,
            r.seq,
          ]),
        );
        let last = room.last_seq;
        const acks = [];
        const entries = [];
        for (const op of list) {
          let seq = known.get(op.id);
          if (seq == null) {
            last += 1;
            seq = last;
            known.set(op.id, seq);
            const { seq: _ignored, ...body } = op;
            entries.push({ seq, id: op.id, type: typeof op.type === 'string' ? op.type : '', body });
          }
          acks.push({ opId: op.id, seq });
        }
        if (entries.length === 0) return acks;

        const text = jsonText(entries);
        await q.query(
          `INSERT INTO trip_ops (trip_id, seq, op_id, type, received_at, body)
           SELECT $1::text, (x.e->>'seq')::int, x.e->>'id', x.e->>'type', $2::timestamptz, x.e->'body'
           FROM jsonb_array_elements($3::jsonb) AS x(e)`,
          [tripId, at, text],
        );
        await q.query('UPDATE trips SET last_seq = $2 WHERE trip_id = $1', [tripId, last]);
        const stored = JSON.parse(text);
        for (const e of stored) {
          const code = e.type === 'trip/issueInvite' ? e.body.invite?.code : undefined;
          if (storableId(code)) {
            await q.query('INSERT INTO invite_codes (code, trip_id, issued_seq) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [code, tripId, e.seq]);
          }
        }
        await redactStored(q, tripId, stored);

        await q.query('SAVEPOINT trip_view');
        try {
          await refresh(q, tripId, room.view_stale ? null : stored.map((e) => e.body));
          await q.query('RELEASE SAVEPOINT trip_view');
        } catch (err) {
          await q.query('ROLLBACK TO SAVEPOINT trip_view');
          await q.query('UPDATE trips SET view_stale = true WHERE trip_id = $1', [tripId]);
          warn(`조회용 표 갱신 실패(${tripId}). 로그는 저장했고 다음 push나 보관 기한 정리 때 로그로 다시 만든다: ${err?.message ?? err}`);
        }
        return acks;
      });
    },

    async pull(tripId, after) {
      if (!storableId(tripId)) return [];
      const n = Number(after);
      const from = Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), INT4_MAX) : n > 0 ? INT4_MAX : 0;
      const { rows } = await db.query('SELECT seq, body FROM trip_ops WHERE trip_id = $1 AND seq > $2 ORDER BY seq', [tripId, from]);
      return rows.map((r) => ({ ...r.body, seq: r.seq }));
    },

    async lookup(code, now) {
      if (!storableId(code)) return { error: 'notFound' };
      const { rows } = await db.query(
        'SELECT i.trip_id FROM invite_codes i JOIN trips t ON t.trip_id = i.trip_id WHERE i.code = $1 ORDER BY t.room_no',
        [code],
      );
      const trips = [];
      for (const r of rows) {
        const log = await db.query('SELECT body FROM trip_ops WHERE trip_id = $1 AND type = ANY($2::text[]) ORDER BY seq', [
          r.trip_id,
          INVITE_OP_TYPES,
        ]);
        trips.push([r.trip_id, log.rows.map((x) => x.body)]);
      }
      return lookupInTrips(trips, code, now);
    },

    async reset() {
      await db.query('TRUNCATE trips, trip_ops, invite_codes, trip_spots, trip_days, trip_legs RESTART IDENTITY');
    },

    /**
     * 보관 기한이 지난 여행방(로그·색인·조회용 표 전부)과 24시간 지난 경로 캐시를 지운다. 지운 tripId를 돌려준다.
     * 지우는 방: retain_until(종료일 다음 날 00:00 KST + 365일)이 지난 방, 생성 op 없이 마지막으로 받은 뒤 365일이 지난 방.
     */
    async purgeExpired(now) {
      await db.query('DELETE FROM route_cache WHERE created_at <= $1', [iso(now - ROUTE_CACHE_TTL_MS)]);
      return db.tx(async (q) => {
        // 조회용 표가 밀린 방은 판정 전에 로그로 다시 만든다. 보관 기한이 그 표의 종료일을 따르므로 다음 push를
        // 기다리지 않는다(끝난 여행에는 push가 거의 오지 않는다). 다시 만들지 못한 방은 지난 표 값으로 판정하고 알린다.
        const stale = await q.query('SELECT trip_id FROM trips WHERE view_stale ORDER BY trip_id FOR UPDATE');
        for (const { trip_id: id } of stale.rows) {
          await q.query('SAVEPOINT purge_view');
          try {
            await refresh(q, id, null);
            await q.query('RELEASE SAVEPOINT purge_view');
          } catch (err) {
            await q.query('ROLLBACK TO SAVEPOINT purge_view');
            warn(`조회용 표 다시 만들기 실패(${id}). 보관 기한은 지난 표 값으로 판정한다: ${err?.message ?? err}`);
          }
        }
        const { rows } = await q.query(
          'DELETE FROM trips WHERE retain_until <= $1 OR (NOT created AND last_received_at <= $2) RETURNING trip_id',
          [iso(now), iso(now - ORPHAN_RETENTION_MS)],
        );
        return rows.map((r) => r.trip_id).sort();
      });
    },

    async health() {
      try {
        await db.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },

    /** 경로 응답 캐시(24시간). 키 숨기는 서버가 OSRM·카카오 응답을 넣고 꺼낸다. */
    routeCache: {
      async get(key, now = Date.now()) {
        const { rows } = await db.query('SELECT response FROM route_cache WHERE key = $1 AND created_at > $2', [key, iso(now - ROUTE_CACHE_TTL_MS)]);
        return rows[0]?.response ?? null;
      },
      async put(key, response, now = Date.now()) {
        await db.query(
          `INSERT INTO route_cache (key, response, created_at) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET response = EXCLUDED.response, created_at = EXCLUDED.created_at`,
          [key, jsonText(response), iso(now)],
        );
      },
    },

    /** 그 방 조회용 표(점검·테스트용). 키 순으로 준다(DB 정렬 규칙과 상관없이). 없는 방이면 trip이 null이고 목록이 비어 있다. */
    async readView(tripId) {
      const v = await loadView(db, tripId);
      const sorted = (map) => [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);
      return { trip: v.trip, spots: sorted(v.spots), days: sorted(v.days), legs: sorted(v.legs) };
    },

    /** 그 방 조회용 표를 로그 전체로 다시 만든다(갱신 규칙을 바꾼 뒤나 view_stale 복구). 방이 없으면 false */
    async rebuildView(tripId) {
      return db.tx(async (q) => {
        const { rows } = await q.query('SELECT 1 FROM trips WHERE trip_id = $1 FOR UPDATE', [tripId]);
        if (rows.length === 0) return false;
        await refresh(q, tripId, null);
        return true;
      });
    },

    close,
  };
}

async function defaultPool(connectionString) {
  const { default: pg } = await import('pg');
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 10_000 });
}

/**
 * DATABASE_URL로 연결하고 마이그레이션까지 마친 저장소를 돌려준다. 붙지 못하면 던진다(메모리로 바꾸지 않는다).
 * createPool은 테스트 주입용이다. 오류 문구에 주소(비밀번호)를 넣지 않는다.
 */
export async function openPostgresStore(url, { createPool = defaultPool, warn = (m) => console.warn(m) } = {}) {
  const pool = await createPool(url);
  pool.on?.('error', (e) => warn(`PostgreSQL 연결 오류: ${e?.message ?? e}`));
  const fail = async (what, e) => {
    await Promise.resolve(pool.end?.()).catch(() => {});
    return new Error(`${what}: ${e?.message ?? e}`);
  };
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    throw await fail('PostgreSQL에 연결하지 못했습니다(DATABASE_URL 확인, 로컬 DB는 npm run db:up)', e);
  }
  const db = sqlDb(pool);
  try {
    await migrate(db);
  } catch (e) {
    throw await fail('PostgreSQL 마이그레이션에 실패했습니다', e);
  }
  return createPostgresStore(db, { close: () => pool.end(), warn });
}
