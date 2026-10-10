/**
 * 계정 탈퇴 가리기(WP2 소유). 비기능 '데이터 보존': 탈퇴하면 본인 사진은 지우고 채팅·제안 이력은 익명 처리한다.
 * 앱은 member/anonymize와 journal/photoRemoved를 보내 문서에서 가린다. 서버 로그(trip_ops.body)에는 원래 값이 남아
 * GET /trips/:id/ops로 내려받을 수 있으므로, 서버도 로그 본문에서 같은 값을 가린다. 메모리와 PostgreSQL 저장소가 같이 쓴다.
 *
 * - 본인이 보낸 member/anonymize(memberId === actorId, 앱 validate selfOnly)가 있는 멤버의 닉네임을 로그 어디서든 가린다
 *   (trip/create의 members, member/join의 member, member/rename). 탈퇴 뒤에 늦게 도착한 op도 받을 때 가린다
 * - journal/photoRemoved를 보낸 사람이 올린(photo.memberId === actorId) 그 사진의 앞선 photoAdded에서 주소·위치를 뺀다
 *   (uri·coord·spotId·sim). 지운 뒤 같은 id로 다시 올린 사진(뒤의 photoAdded)은 건드리지 않는다
 * - 가린 값이 op의 유효성을 바꾸지 않게 한다. 앱이 이 로그를 접은 문서는 가리기 전과 같다(tests/wp2-db.test.ts)
 *   닉네임: 유효한 닉네임(1~12자)은 '탈퇴한 멤버'로, 유효하지 않은 값은 ''로(여전히 badNickname으로 거부된다)
 *   사진 주소: 앱이 거부하는 blob:·data: 주소는 'data:,'로(여전히 거부), 나머지는 뺀다
 * 하지 않는 것: 채팅 본문, userId(무작위 id), takenAt 같은 필수 필드. 기기에 이미 내려받은 로그는 서버가 고칠 수 없다.
 * 삭제된 방에도 가린다(앱은 삭제된 방의 op를 거부하지만 그 문서는 보이지 않는다).
 */
import { storableId } from './ids.mjs';

/** 앱 DELETED_MEMBER_NAME과 같다 */
export const DELETED_MEMBER_NAME = '탈퇴한 멤버';
/** 앱 NICKNAME_MAX와 같다 */
export const NICKNAME_MAX = 12;

/** 닉네임이 들어 있는 op 종류 */
export const NICKNAME_OP_TYPES = ['trip/create', 'member/join', 'member/rename'];
/** 받으면 로그를 다시 가려 봐야 하는 op 종류 */
export const REDACT_TRIGGER_TYPES = [...NICKNAME_OP_TYPES, 'member/anonymize', 'journal/photoRemoved'];

const PHOTO_PRIVATE_KEYS = ['coord', 'spotId', 'sim'];

/** 본인이 보낸 탈퇴 op면 그 멤버 id, 아니면 null */
export function anonymizedMember(op) {
  return op?.type === 'member/anonymize' && storableId(op.memberId) && op.memberId === op.actorId ? op.memberId : null;
}

/** 가린 닉네임. 앱 validNickname 결과(유효·무효)를 바꾸지 않는다. 문자열이 아니면 그대로 */
function maskName(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return t.length >= 1 && t.length <= NICKNAME_MAX ? DELETED_MEMBER_NAME : '';
}

/** 그 멤버들의 닉네임을 가린 op. 바뀐 것이 없으면 null */
export function maskNicknames(op, memberIds) {
  if (!op || typeof op !== 'object' || memberIds.size === 0) return null;
  const hit = (m) => m && typeof m === 'object' && memberIds.has(m.id) && maskName(m.nickname) !== m.nickname;
  switch (op.type) {
    case 'trip/create': {
      const members = op.trip?.members;
      if (!Array.isArray(members) || !members.some(hit)) return null;
      return { ...op, trip: { ...op.trip, members: members.map((m) => (hit(m) ? { ...m, nickname: maskName(m.nickname) } : m)) } };
    }
    case 'member/join':
      return hit(op.member) ? { ...op, member: { ...op.member, nickname: maskName(op.member.nickname) } } : null;
    case 'member/rename':
      return memberIds.has(op.memberId) && maskName(op.nickname) !== op.nickname ? { ...op, nickname: maskName(op.nickname) } : null;
    default:
      return null;
  }
}

const isForbiddenUri = (uri) => typeof uri === 'string' && /^\s*(blob|data):/i.test(uri);

/** 사진 주소·위치를 뺀 photoAdded. 바뀐 것이 없으면 null */
export function maskPhoto(op) {
  const p = op?.photo;
  if (!p || typeof p !== 'object') return null;
  const next = { ...p };
  let changed = false;
  if ('uri' in next) {
    if (isForbiddenUri(next.uri)) {
      if (next.uri !== 'data:,') {
        next.uri = 'data:,';
        changed = true;
      }
    } else {
      delete next.uri;
      changed = true;
    }
  }
  for (const k of PHOTO_PRIVATE_KEYS) {
    if (k in next) {
      delete next[k];
      changed = true;
    }
  }
  return changed ? { ...op, photo: next } : null;
}

const photoKey = (photoId, memberId) => `${photoId}\u0001${memberId}`;

/**
 * 로그(seq 순, 일부 종류만 골라 줘도 된다)를 가린다. index → 가린 op 맵을 돌려준다(바뀐 op만).
 * 닉네임은 탈퇴 op와 순서에 상관없이, 사진은 photoRemoved보다 앞선 photoAdded만 가린다.
 */
export function redactLog(ops) {
  const anon = new Set();
  for (const op of ops) {
    const m = anonymizedMember(op);
    if (m) anon.add(m);
  }
  const out = new Map();
  const removedLater = new Set();
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    if (!op || typeof op !== 'object') continue;
    if (op.type === 'journal/photoRemoved') {
      if (typeof op.photoId === 'string' && typeof op.actorId === 'string') removedLater.add(photoKey(op.photoId, op.actorId));
    } else if (op.type === 'journal/photoAdded') {
      const p = op.photo;
      if (p && typeof p.id === 'string' && typeof p.memberId === 'string' && removedLater.has(photoKey(p.id, p.memberId))) {
        const next = maskPhoto(op);
        if (next) out.set(i, next);
      }
    } else if (anon.size > 0) {
      const next = maskNicknames(op, anon);
      if (next) out.set(i, next);
    }
  }
  return out;
}
