import { activeMembers, isHost, tripMode } from '../../core/group';
import { coverUri } from '../../core/trip/cover';
import { regionById } from '../../data/regions';
import type { OpBody, Trip } from '../../types';

/**
 * 채팅방 목록(2026-10-17 사용자 요청, 순수). 하단 탭 '채팅'을 누르면 먼저 이 목록이 뜨고, 방을 누르면 그 채팅으로 간다.
 * 채팅방은 여행방마다 하나다(따로 만들지 않는다). 채팅 화면 머리의 방 이름을 눌러도 같은 목록으로 방을 바꾼다.
 * - 칸: 여행방 표지(홈 카드와 같은 사진, 없으면 지역 이름), 방 이름, 마지막 말(없으면 줄 없음), 마지막 말 시각, 멤버 수(혼자면 '채팅 메모'), 고정 표시
 * - 순서: 고정한 방 먼저, 그 안과 나머지는 마지막 활동(마지막 말, 없으면 방 만든 때) 최근 순
 * - 꾹 누르면 고정/고정 해제와 삭제. 고정은 이 기기에만 둔다(store/ui pinnedChats)
 * - 삭제는 그 여행방에서 나가는 것이다(경고 한 번). 방장은 나갈 수 없어 여행방 삭제가 된다(다른 멤버에게서도 사라진다고 적는다)
 */

export interface ChatRoomRow {
  tripId: string;
  title: string;
  /** 마지막 말('닉네임: 내용'). 말이 없으면 빈 문자열(목록은 둘째 줄을 그리지 않는다) */
  preview: string;
  /** 마지막 활동 시각(ms). 정렬과 시각 표시에 쓴다 */
  at: number;
  /** 마지막 말이 있을 때만 시각을 보인다 */
  hasMessage: boolean;
  pinned: boolean;
  /** '멤버 3명' 또는 '채팅 메모'(혼자 여행) */
  meta: string;
  /** 여행방 표지 이미지 주소(홈 여행 카드와 같은 표지). 없으면 지역 이름 칸 */
  cover?: string;
  /** 표지가 없을 때 칸 가운데 보일 지역 이름(홈 카드와 같다) */
  place: string;
  /** 여행 기간 짧게('10/23 – 10/24', 당일이면 '10/23') */
  dates: string;
}

/** 'YYYY-MM-DD' 둘 → '10/23 – 10/24'(같은 날이면 하나) */
export function shortPeriod(start: string, end: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return start === end ? md(start) : `${md(start)} – ${md(end)}`;
}

export function chatRooms(trips: readonly Trip[], pinned: readonly string[]): ChatRoomRow[] {
  const rows = trips.map((t): ChatRoomRow => {
    const last = t.messages.length > 0 ? t.messages[t.messages.length - 1] : undefined;
    const who = last ? t.members.find((m) => m.id === last.memberId)?.nickname : undefined;
    const group = tripMode(t) === 'group';
    return {
      tripId: t.id,
      title: t.title,
      preview: last ? (group && who ? `${who}: ${last.text}` : last.text) : '',
      at: last?.sentAt ?? t.createdAt,
      hasMessage: !!last,
      pinned: pinned.includes(t.id),
      meta: group ? `멤버 ${activeMembers(t).length}명` : '채팅 메모',
      cover: coverUri(t.cover),
      place: regionById(t.region)?.name ?? t.title,
      dates: shortPeriod(t.startDate, t.endDate),
    };
  });
  return rows.sort((a, b) => (a.pinned === b.pinned ? b.at - a.at : a.pinned ? -1 : 1));
}

/**
 * 채팅방 검색(목록 위 검색칸). 방 이름 또는 마지막 말에 들어 있으면 남긴다(대소문자·공백 무시, 한글은 그대로 비교).
 * 빈 검색어면 그대로 돌려준다. 순서(고정 먼저·최근 순)는 바꾸지 않는다
 */
export function filterRooms(rows: readonly ChatRoomRow[], query: string): ChatRoomRow[] {
  const q = query.normalize('NFC').replace(/\s+/g, '').toLowerCase();
  if (!q) return [...rows];
  const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, '').toLowerCase();
  return rows.filter((r) => norm(r.title).includes(q) || (r.hasMessage && norm(r.preview).includes(q)));
}

/** 목록 시각: 오늘이면 '14:05', 아니면 '10/17' (KST) */
export function roomTime(at: number, now: number): string {
  const kst = (ms: number) => new Date(ms + 9 * 3600_000);
  const a = kst(at);
  const n = kst(now);
  const sameDay = a.getUTCFullYear() === n.getUTCFullYear() && a.getUTCMonth() === n.getUTCMonth() && a.getUTCDate() === n.getUTCDate();
  if (sameDay) return `${String(a.getUTCHours()).padStart(2, '0')}:${String(a.getUTCMinutes()).padStart(2, '0')}`;
  return `${a.getUTCMonth() + 1}/${a.getUTCDate()}`;
}

/** 채팅방 삭제의 경고 문구와 실제로 보낼 op. 방장은 나갈 수 없으므로 여행방 삭제다 */
export function deleteRoomPlan(trip: Trip, me: string): { op: OpBody; title: string; text: string; confirmLabel: string } {
  if (isHost(trip, me)) {
    const others = activeMembers(trip).length > 1;
    return {
      op: { type: 'trip/delete' },
      title: '채팅방을 삭제할까요',
      text: others
        ? '방장이 채팅방을 삭제하면 여행방이 삭제돼요. 다른 멤버도 더는 이 여행방과 채팅을 볼 수 없어요.'
        : '채팅방을 삭제하면 여행방도 함께 삭제돼요. 후보·시간표·기록이 모두 사라져요.',
      confirmLabel: '삭제',
    };
  }
  return {
    op: { type: 'member/leave', memberId: me },
    title: '채팅방을 삭제할까요',
    text: '채팅방을 삭제하면 이 여행방에서 나가져요. 내가 제안한 후보와 채팅은 \'나간 멤버\'로 남고, 다시 들어오려면 초대 링크가 필요해요.',
    confirmLabel: '삭제하고 나가기',
  };
}
