/**
 * 조회용 표 계산(WP2 소유, 순수). 원천은 이벤트 로그(trip_ops)이고, 이 파일은 op에 든 값을 여행방 요약·스팟·
 * 날짜별 일정·구간 이동수단으로 옮긴다. Postgres 저장소가 push 트랜잭션 안에서 새 op만 더하고(증분),
 * 갱신이 실패했던 방은 로그 전체로 다시 만든다. 메모리 저장소는 보관 기한 판정(종료일)에만 쓴다.
 *
 * 앱 리듀서(src/core/ops)를 통째로 옮기지 않는다. 옮기는 것은 이것뿐이다.
 * - 생성 op 전에 온 op, 삭제된 방의 op, 종료일(KST)이 지난 시각의 편집은 버린다(앱 잠금과 같다)
 * - 필드 충돌은 앱처럼 op.at 나중 저장 우선이다(스팟·날짜는 edited 맵, 구간은 at과 cleared 묘비)
 * - 같은 placeId 후보는 하나로 합친다. 채팅 추출 되돌리기는 제안을 메시지 단위로만 센다(messageIds, manual)
 * - 모호한 장소 고르기는 추출 기록에 있는 아직 안 고른 항목만 한 번 받는다(동시에 둘이 골라도 먼저 온 것만, 앱 reduceResolve)
 * - 기간을 바꾸는 trip/update와 방 삭제는 방장(생성 때 role 'host', 탈퇴하지 않음)이 보낸 것만 받는다.
 *   보관 기한이 이 표의 종료일을 따르므로, 멤버가 아닌 사람의 op 하나로 방이 일찍 지워지지 않게 한다
 * - 날짜·구간·순서처럼 행 모양을 망가뜨리는 값만 앱 validate와 같이 거른다
 * 하지 않는 것: 나머지 권한·멤버 여부·체류 범위 검증, 제안자 목록, 채팅·멤버·사진·일기, 일정 계산
 * (plan은 동기화하지 않고 기기마다 계산한다). 그래서 앱이 접을 때 버리는 op가 여기에는 반영될 수 있다.
 * 정답은 언제나 앱이 로그를 접은 문서이고, 이 표는 조회·운영용이다.
 *
 * 값은 표에 넣을 수 있는 모양으로 고친다(문자열이 아니면 null, 없는 날짜면 null, 서버가 다루지 못하는 시각이면 null,
 * 키로 못 쓰는 id면 그 행을 만들지 않는다). 잘못된 op 하나가 원천 로그 저장을 막거나 표를 계속 실패하게 하지 않으려는 것이다.
 *
 * 조회 상태에는 표 행 말고 계산에만 쓰는 상태(hosts: 방장 멤버 id, picks: 메시지별 모호 항목을 골랐는지)가 있다.
 * Postgres는 trips.view_state에 둔다.
 */
import { storableId } from '../ids.mjs';
import { addDays, daysBetween, isDate, kstDate, MAX_TIME_MS } from '../retention.mjs';

/** 기간을 맞출 때 기본 날짜 행을 만드는 최대 일수(앱 MAX_TRIP_DAYS는 14). 넘으면 기간 밖 날짜만 버린다. */
const MAX_VIEW_DAYS = 366;
const TRANSPORTS = new Set(['car', 'walk', 'transit']);
const TRIP_PATCH_KEYS = new Set(['title', 'region', 'startDate', 'endDate', 'transport', 'dayStart', 'dayEnd']);
const DAY_PATCH_KEYS = new Set(['base', 'noReturn', 'dayStart', 'dayEnd']);
const INT4_MAX = 2_147_483_647;

const str = (v) => (typeof v === 'string' ? v : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (Number.isSafeInteger(v) && Math.abs(v) <= INT4_MAX ? v : null);
/** timestamptz·bigint에 넣을 수 있고 KST 날짜로 바꿀 수 있는 시각(ms, 정수) */
const ms = (v) => (Number.isSafeInteger(v) && v >= 0 && v <= MAX_TIME_MS ? v : null);
const date = (v) => (isDate(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const lww = (prevAt, at) => prevAt == null || at >= prevAt;

function editedOf(v) {
  const out = {};
  if (v && typeof v === 'object') for (const [k, t] of Object.entries(v)) if (num(t) != null) out[k] = t;
  return out;
}

export function emptyView() {
  return { trip: null, spots: new Map(), days: new Map(), legs: new Map(), hosts: new Set(), picks: new Map() };
}

export function legKey(date, fromId, toId) {
  return `${date}\u0001${fromId}\u0001${toId}`;
}

/* ---------- 행 만들기 ---------- */

function inviteFrom(v) {
  if (!v || typeof v !== 'object' || typeof v.code !== 'string' || v.code.length === 0) return null;
  return { code: v.code, issuedAt: ms(v.issuedAt), expiresAt: ms(v.expiresAt), capacity: int(v.capacity), revokedAt: ms(v.revokedAt) };
}

function tripFrom(t) {
  return {
    title: str(t.title),
    region: str(t.region),
    startDate: date(t.startDate),
    endDate: date(t.endDate),
    transport: str(t.transport),
    dayStart: str(t.dayStart),
    dayEnd: str(t.dayEnd),
    createdBy: str(t.createdBy),
    createdAt: ms(t.createdAt),
    deletedAt: ms(t.deletedAt),
    invite: inviteFrom(t.invite),
  };
}

/** 제안 목록 → 메시지 단위 요약. 메시지에 묶이지 않은 제안(직접 추가)이 하나라도 있으면 manual */
function proposalKeys(proposals) {
  const messageIds = [];
  let manual = false;
  for (const p of arr(proposals)) {
    if (typeof p?.messageId === 'string') {
      if (!messageIds.includes(p.messageId)) messageIds.push(p.messageId);
    } else manual = true;
  }
  return { messageIds, manual };
}

function addKeys(spot, keys) {
  for (const m of keys.messageIds) if (!spot.messageIds.includes(m)) spot.messageIds.push(m);
  if (keys.manual) spot.manual = true;
}

function spotFrom(s, proposals) {
  if (!s || typeof s !== 'object' || !storableId(s.id) || !storableId(s.placeId)) return null;
  const order = s.manualOrder && date(s.manualOrder.date) && int(s.manualOrder.index) != null ? s.manualOrder : null;
  const keys = proposalKeys(proposals);
  return {
    id: s.id,
    placeId: s.placeId,
    name: str(s.name) ?? '',
    category: str(s.category),
    kind: str(s.kind),
    lat: num(s.coord?.latitude),
    lng: num(s.coord?.longitude),
    address: str(s.address),
    pinned: s.pinned === true,
    stayMin: int(s.stayMin),
    fixedDate: date(s.fixedDate),
    manualDate: order ? order.date : null,
    manualIndex: order ? order.index : null,
    arriveOverride: str(s.arriveOverride),
    removed: s.removedByUser === true,
    removedReason: str(s.removedReason),
    messageIds: keys.messageIds,
    manual: keys.manual,
    createdAt: ms(s.createdAt),
    edited: editedOf(s.edited),
  };
}

function setBase(day, v) {
  day.baseName = null;
  day.baseLat = null;
  day.baseLng = null;
  day.basePlaceId = null;
  if (v === null) {
    day.baseMode = 'firstSpot';
  } else if (v && typeof v === 'object' && typeof v.name === 'string') {
    day.baseMode = 'set';
    day.baseName = v.name;
    day.baseLat = num(v.coord?.latitude);
    day.baseLng = num(v.coord?.longitude);
    day.basePlaceId = str(v.placeId);
  } else {
    day.baseMode = 'inherit';
  }
}

function defaultDay(d, base) {
  const day = { date: d, baseMode: 'inherit', baseName: null, baseLat: null, baseLng: null, basePlaceId: null, noReturn: false, dayStart: null, dayEnd: null, transport: null, edited: {} };
  setBase(day, base);
  return day;
}

function dayFrom(d) {
  if (!d || typeof d !== 'object' || !isDate(d.date)) return null;
  const day = defaultDay(d.date, d.base);
  day.noReturn = d.noReturn === true;
  day.dayStart = str(d.dayStart);
  day.dayEnd = str(d.dayEnd);
  day.transport = str(d.transport);
  day.edited = editedOf(d.edited);
  return day;
}

function legFrom(l) {
  if (!l || typeof l !== 'object' || !isDate(l.date) || !storableId(l.fromId) || !storableId(l.toId)) return null;
  const transport = str(l.transport);
  if (!transport) return null;
  return { date: l.date, fromId: l.fromId, toId: l.toId, transport, at: ms(l.at), cleared: l.cleared === true };
}

/* ---------- 필드 LWW(앱 ops/lww.ts와 같은 규칙) ---------- */

const SPOT_EDIT_KEY = {
  pinned: 'pinned',
  stayMin: 'stayMin',
  fixedDate: 'fixedDate',
  manualOrder: 'manualOrder',
  arriveOverride: 'arriveOverride',
  removed: 'removedByUser',
  removedReason: 'removedByUser',
};

function setSpotField(s, k, v) {
  switch (k) {
    case 'pinned':
    case 'removed':
      s[k] = v === true;
      break;
    case 'stayMin':
      s.stayMin = int(v);
      break;
    case 'fixedDate':
      s.fixedDate = date(v);
      break;
    case 'manualOrder': {
      const ok = v && date(v.date) && int(v.index) != null;
      s.manualDate = ok ? v.date : null;
      s.manualIndex = ok ? v.index : null;
      break;
    }
    default:
      s[k] = str(v);
  }
}

/** 값이 null이면 해제다(앱의 undefined). 판정은 고치기 전 edited로 한다(같은 키 두 필드가 같이 움직인다). */
function patchSpot(s, patch, at) {
  const touched = new Set();
  for (const [k, v] of Object.entries(patch)) {
    const key = SPOT_EDIT_KEY[k];
    if (!lww(s.edited[key], at)) continue;
    setSpotField(s, k, v);
    touched.add(key);
  }
  for (const key of touched) s.edited[key] = at;
}

function patchDay(view, d, patch, at) {
  const prev = view.days.get(d) ?? defaultDay(d, 'inherit');
  const next = { ...prev, edited: { ...prev.edited } };
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (!lww(prev.edited[k], at)) continue;
    if (k === 'base') setBase(next, v);
    else if (k === 'noReturn') next.noReturn = v === true;
    else next[k] = str(v);
    next.edited[k] = at;
    changed = true;
  }
  if (changed) view.days.set(d, next);
}

/* ---------- op 적용 ---------- */

/** 같은 placeId는 하나로 합치고 제안만 더한다(앱 upsertSpot). */
function upsertSpot(view, s, proposals) {
  if (!s || typeof s.placeId !== 'string') return;
  for (const cur of view.spots.values()) {
    if (cur.placeId === s.placeId) {
      addKeys(cur, proposalKeys(proposals));
      return;
    }
  }
  if (typeof s.id !== 'string' || view.spots.has(s.id)) return;
  const row = spotFrom(s, proposals);
  if (row) view.spots.set(row.id, row);
}

/** 기간이 바뀌면 날짜 행을 새 기간에 맞춘다(앱 fitDays). 새 날짜는 첫날이면 기점 없음, 아니면 직전과 같음 */
function fitDays(view, start, end) {
  const n = daysBetween(start, end);
  const next = new Map();
  if (n > MAX_VIEW_DAYS) {
    for (const [d, day] of view.days) if (d >= start && d <= end) next.set(d, day);
  } else {
    for (let i = 0; i <= n; i += 1) {
      const d = addDays(start, i);
      next.set(d, view.days.get(d) ?? defaultDay(d, i === 0 ? null : 'inherit'));
    }
  }
  view.days = next;
}

function createFrom(view, t) {
  view.trip = tripFrom(t);
  const { startDate, endDate } = view.trip;
  view.days = new Map();
  // 기간 안 날짜만, 최대 MAX_VIEW_DAYS개(앱은 기간 날짜를 그대로 만든다. 날짜 수만 개짜리 생성 op가 방을 오래 잡지 않게)
  for (const d of arr(t.days)) {
    if (view.days.size >= MAX_VIEW_DAYS) break;
    const day = dayFrom(d);
    if (day && (!startDate || day.date >= startDate) && (!endDate || day.date <= endDate)) view.days.set(day.date, day);
  }
  view.spots = new Map();
  for (const s of arr(t.spots)) {
    const row = spotFrom(s, s?.proposals);
    if (row && !view.spots.has(row.id)) view.spots.set(row.id, row);
  }
  view.legs = new Map();
  for (const l of arr(t.legs)) {
    const leg = legFrom(l);
    if (leg) view.legs.set(legKey(leg.date, leg.fromId, leg.toId), leg);
  }
  view.hosts = new Set();
  for (const m of arr(t.members)) {
    if (m && m.role === 'host' && m.leftAt == null && storableId(m.id)) view.hosts.add(m.id);
  }
  view.picks = new Map();
}

function updateTrip(view, p) {
  if (!p || typeof p !== 'object' || Object.keys(p).some((k) => !TRIP_PATCH_KEYS.has(k))) return;
  const next = { ...view.trip };
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    if (k === 'title') {
      const t = str(v)?.trim();
      if (!t) return;
      next.title = t;
    } else if (k === 'startDate' || k === 'endDate') {
      if (!isDate(v)) return;
      next[k] = v;
    } else if (k === 'transport') {
      if (!TRANSPORTS.has(v)) return;
      next.transport = v;
    } else next[k] = str(v);
  }
  if (next.startDate && next.endDate && next.endDate < next.startDate) return;
  const moved = next.startDate !== view.trip.startDate || next.endDate !== view.trip.endDate;
  view.trip = next;
  if (moved && next.startDate && next.endDate) fitDays(view, next.startDate, next.endDate);
}

function reorder(view, op) {
  const ids = arr(op.spotIds);
  if (new Set(ids).size !== ids.length || !ids.every((id) => view.spots.has(id))) return;
  const index = new Map(ids.map((id, i) => [id, i]));
  for (const s of view.spots.values()) {
    const i = index.get(s.id);
    if (i !== undefined) patchSpot(s, { manualOrder: { date: op.date, index: i } }, op.at);
    else if (s.manualDate === op.date) patchSpot(s, { manualOrder: null }, op.at);
  }
}

function setLeg(view, op) {
  if (!storableId(op.fromId) || !storableId(op.toId) || op.fromId === op.toId) return;
  if (op.transport !== null && !TRANSPORTS.has(op.transport)) return;
  const key = legKey(op.date, op.fromId, op.toId);
  const prev = view.legs.get(key);
  if (prev && !lww(prev.at, op.at)) return;
  view.legs.delete(key);
  view.legs.set(
    key,
    op.transport
      ? { date: op.date, fromId: op.fromId, toId: op.toId, transport: op.transport, at: op.at, cleared: false }
      : { date: op.date, fromId: op.fromId, toId: op.toId, transport: prev?.transport ?? 'car', at: op.at, cleared: true },
  );
}

/** op 하나를 조회 상태에 더한다(view를 고친다). 표에 영향이 없는 op는 그냥 지나간다. */
export function applyToView(view, op) {
  if (!op || typeof op !== 'object' || typeof op.type !== 'string' || ms(op.at) == null) return view;
  if (op.type === 'trip/create') {
    if (!view.trip && op.trip && typeof op.trip === 'object') createFrom(view, op.trip);
    return view;
  }
  const trip = view.trip;
  if (!trip || trip.deletedAt != null) return view;
  // 계정 탈퇴는 종료 잠금 예외다. 탈퇴한 방장은 더는 기간을 바꾸거나 방을 지우지 못한다(앱 activeActor)
  if (op.type === 'member/anonymize') {
    if (op.memberId === op.actorId) view.hosts.delete(op.memberId);
    return view;
  }
  // 종료 잠금: 종료일이 지난 시각의 편집은 앱도 버린다. 표에 옮기는 op 중 예외는 방 삭제뿐이다.
  if (op.type !== 'trip/delete' && trip.endDate && kstDate(op.at) > trip.endDate) return view;
  const inPeriod = (d) => isDate(d) && (!trip.startDate || d >= trip.startDate) && (!trip.endDate || d <= trip.endDate);
  const spot = typeof op.spotId === 'string' ? view.spots.get(op.spotId) : undefined;
  switch (op.type) {
    case 'trip/update':
      if (view.hosts.has(op.actorId)) updateTrip(view, op.patch);
      break;
    case 'trip/setDay': {
      const p = op.patch;
      if (!inPeriod(op.date) || !p || typeof p !== 'object' || Object.keys(p).some((k) => !DAY_PATCH_KEYS.has(k))) break;
      patchDay(view, op.date, p, op.at);
      break;
    }
    case 'trip/delete':
      if (view.hosts.has(op.actorId)) trip.deletedAt = op.at;
      break;
    case 'trip/issueInvite': {
      const inv = inviteFrom(op.invite);
      if (inv) trip.invite = inv;
      break;
    }
    case 'trip/revokeInvite':
      if (trip.invite && trip.invite.revokedAt == null) trip.invite = { ...trip.invite, revokedAt: op.at };
      break;
    case 'spot/add': {
      const props = arr(op.spot?.proposals).length > 0 ? op.spot.proposals : [{}];
      upsertSpot(view, op.spot, props);
      break;
    }
    case 'spot/extracted': {
      if (typeof op.messageId !== 'string') break;
      const chat = [{ messageId: op.messageId }];
      for (const s of arr(op.created)) upsertSpot(view, s, chat);
      for (const id of arr(op.mergedSpotIds)) {
        const cur = view.spots.get(id);
        if (cur) addKeys(cur, proposalKeys(chat));
      }
      // 고를 항목을 새로 적는다. 추출 결과가 있으면 앞선 기록을 덮는다(앱 reduceExtracted)
      const phrases = arr(op.ambiguous).flatMap((a) => (typeof a?.phrase === 'string' ? [a.phrase] : []));
      if (phrases.length > 0) view.picks.set(op.messageId, new Map(phrases.map((p) => [p, false])));
      else if (arr(op.created).length > 0 || arr(op.mergedSpotIds).length > 0 || arr(op.highlights).length > 0) view.picks.delete(op.messageId);
      break;
    }
    case 'spot/resolveAmbiguous': {
      // 추출 기록에 있고 아직 안 고른 항목만 한 번 받는다. 두 사람이 동시에 고르면 먼저 온 것만 남는다(앱 reduceResolve)
      const picks = typeof op.messageId === 'string' ? view.picks.get(op.messageId) : undefined;
      if (!picks || picks.get(op.phrase) !== false) break;
      const target = op.mergeIntoSpotId ? view.spots.get(op.mergeIntoSpotId) : undefined;
      if (op.mergeIntoSpotId && !target) break; // 합칠 후보가 없으면 앱 validate가 버린다
      picks.set(op.phrase, true); // 장소 없이 오면 '고르지 않음'으로 닫는다
      const chat = [{ messageId: op.messageId }];
      if (target) addKeys(target, proposalKeys(chat));
      else if (op.spot) upsertSpot(view, op.spot, chat);
      break;
    }
    case 'spot/undoExtraction':
      // 그 메시지의 제안만 뺀다. 남은 제안이 없으면 지운다. 추출 기록도 없어져 더 고를 수 없다(앱 reduceUndo).
      view.picks.delete(op.messageId);
      for (const [id, s] of view.spots) {
        if (!s.messageIds.includes(op.messageId)) continue;
        s.messageIds = s.messageIds.filter((m) => m !== op.messageId);
        if (s.messageIds.length === 0 && !s.manual) view.spots.delete(id);
      }
      break;
    case 'spot/pin':
      if (spot) patchSpot(spot, { pinned: op.pinned }, op.at);
      break;
    case 'spot/remove':
      if (spot) patchSpot(spot, { removed: true, removedReason: op.reason ?? 'user' }, op.at);
      break;
    case 'spot/restore':
      if (spot) patchSpot(spot, { removed: false, removedReason: null, pinned: true }, op.at);
      break;
    case 'spot/delete':
      if (spot) view.spots.delete(spot.id);
      break;
    case 'schedule/reorder':
      if (inPeriod(op.date)) reorder(view, op);
      break;
    case 'schedule/setStay':
      if (spot) patchSpot(spot, { stayMin: op.stayMin }, op.at);
      break;
    case 'schedule/setArrive':
      if (spot) patchSpot(spot, { arriveOverride: op.arrive }, op.at);
      break;
    case 'schedule/setDate': {
      if (!spot || (op.date !== null && !inPeriod(op.date))) break;
      // 날짜 지정 해제(null)는 수동 순서를 건드리지 않는다. 다른 날짜로 옮길 때만 그 순서를 푼다
      const moved = op.date !== null && spot.manualDate != null && spot.manualDate !== op.date;
      patchSpot(spot, moved ? { fixedDate: op.date, manualOrder: null } : { fixedDate: op.date }, op.at);
      break;
    }
    case 'schedule/setDayTransport':
      if (!inPeriod(op.date) || (op.transport !== null && !TRANSPORTS.has(op.transport))) break;
      patchDay(view, op.date, { transport: op.transport }, op.at);
      break;
    case 'schedule/setLegTransport':
      if (inPeriod(op.date)) setLeg(view, op);
      break;
    default:
      break;
  }
  return view;
}

/** 로그(seq 순)를 처음부터 접는다. 증분 결과와 같아야 한다. */
export function projectOps(ops, view = emptyView()) {
  for (const op of ops) applyToView(view, op);
  return view;
}
