import type { ExcludedSpot, HostPick, Plan, Spot, TimetableItem, Transport, Trip } from '../../types';
import { TRANSPORT_LABEL } from '../../core/constants';
import { activeMembers, memberById } from '../../core/group';
import { proposerIds, spotVoterIds, votePinned } from '../../core/spotUtil';
import { daysBetween, dayShort, josa } from '../../core/util';
import { daySegLabel } from '../schedule/view';
import { kindLabel } from './rows';

/**
 * 07 스팟 상세 계산(FR-803, WP3 소유, 순수). 정보가 없는 항목은 만들지 않는다(화면이 생략한다).
 */

export interface DetailInfoCell {
  label: string;
  value: string;
}

export interface SpotDetail {
  status: 'confirmed' | 'excluded' | 'pending';
  eyebrow: string;
  sub: string;
  cells: DetailInfoCell[];
  proposerNames: string[];
  /** 제안자 id와 이름. 아바타 색은 화면이 멤버 등록 순(memberIndex)으로 정한다. */
  proposers: { id: string; name: string }[];
  quotes: { text: string; who: string }[];
  excluded?: ExcludedSpot;
  date?: string;
  item?: TimetableItem;
  /** 체류 분과 사용자가 바꿨는지(라벨 '체류'/'기본 체류') */
  stayMin: number;
  stayEdited: boolean;
  /** 사용자가 지정한 날짜(없으면 자동 배분) */
  fixedDate?: string;
  pinned: boolean;
  /** 방장이 뺀 후보(hostPick drop). 아래 버튼을 두지 않는다 */
  hostDropped: boolean;
  /** 기점에서 오는 이동 '자동차 12분'(구할 수 없거나 기점이 곧 이 스팟이면 없음) */
  move?: string;
}

/** 스팟이 배치된 날짜·항목과 그날 안의 자리(0부터) */
export function placement(plan: Plan | undefined, spotId: string): { date: string; item: TimetableItem; index: number } | undefined {
  for (const d of plan?.days ?? []) {
    const i = d.items.findIndex((x) => x.spotId === spotId);
    if (i >= 0) return { date: d.date, item: d.items[i], index: i };
  }
  return undefined;
}

/** 여행 몇째 날인지. 기간 밖이면 'N일째' */
export function dayOrdinal(trip: Pick<Trip, 'startDate'>, date: string): string {
  const n = daysBetween(trip.startDate, date);
  const names = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째'];
  return names[n] ? `${names[n]} 날` : `${n + 1}일째`;
}

/**
 * 기점에서 이 스팟으로 올 때 쓰는 이동수단. 그날 수단(없으면 여행 수단) 하나로 정한다.
 * 07 '기점에서' 칸의 라벨과 화면의 경로 요청이 같은 값을 쓴다(구간 수단 legTransport는 직전 지점에서 오는 수단이라 쓰지 않는다).
 */
export function baseTransport(trip: Pick<Trip, 'days' | 'transport'>, date: string | undefined): Transport {
  return (date ? trip.days.find((d) => d.date === date)?.transport : undefined) ?? trip.transport;
}

/**
 * baseMin: 기점에서 이 스팟까지 이동 분(화면이 baseTransport 수단으로 경로 제공자에서 구해 넘긴다, 없으면 생략).
 * 그날 첫 항목이고 기점이 있으면 시간표의 travelMin이 곧 기점에서 온 시간이다(수단은 그 구간 수단).
 * 기점이 그날 첫 스팟(baseSource 'firstSpot')이면 '기점에서' 칸을 만들지 않는다.
 */
export function spotDetail(trip: Trip, plan: Plan | undefined, spot: Spot, baseMin?: number): SpotDetail {
  const at = placement(plan, spot.id);
  const excluded = plan?.excluded.find((e) => e.spotId === spot.id);
  const status: SpotDetail['status'] = excluded || spot.removedByUser ? 'excluded' : at ? 'confirmed' : 'pending';
  const eyebrow =
    status === 'confirmed' && at
      ? `확정 스팟 · ${dayShort(at.date)} ${dayOrdinal(trip, at.date)}`
      : status === 'excluded'
        ? '제외 스팟'
        : '후보 · 배치 계산 전';
  // 제외 사유는 excluded 카드 한 곳에만 적는다(eyebrow에 되풀이하지 않는다). 영업시간은 보조 줄에 둔다.
  const hours = spot.hours ? `영업 ${spot.hours.open}–${spot.hours.close}` : undefined;
  const sub = [kindLabel(spot), spot.address, hours, spot.outsideRegion ? '목적지 밖' : undefined].filter(Boolean).join(' · ');

  const cells: DetailInfoCell[] = [{ label: spot.edited.stayMin != null ? '체류' : '기본 체류', value: `${spot.stayMin}분` }];
  const dayPlan = at ? plan?.days.find((d) => d.date === at.date) : undefined;
  const firstWithBase = !!(at && at.index === 0 && dayPlan?.base);
  const firstIsBase = !!(at && at.index === 0 && dayPlan?.baseSource === 'firstSpot');
  const transport = firstWithBase && at?.item.legTransport ? at.item.legTransport : baseTransport(trip, at?.date);
  const fromBase = firstIsBase ? undefined : firstWithBase ? at?.item.travelMin : baseMin;
  const move = fromBase != null ? `${TRANSPORT_LABEL[transport]} ${Math.round(fromBase)}분` : undefined;
  if (move) cells.push({ label: '기점에서', value: move });
  if (at) cells.push({ label: '배치 시각', value: at.item.arrive });

  const ids = proposerIds(spot);
  const proposers = ids.map((id) => ({ id, name: memberById(trip, id)?.nickname ?? '나간 멤버' }));
  const proposerNames = proposers.map((p) => p.name);
  const quotes: SpotDetail['quotes'] = [];
  for (const p of spot.proposals) {
    if (!p.messageId) continue;
    const msg = trip.messages.find((m) => m.id === p.messageId);
    if (!msg || quotes.some((q) => q.text === msg.text)) continue;
    quotes.push({ text: msg.text, who: memberById(trip, msg.memberId)?.nickname ?? '나간 멤버' });
  }
  if (quotes.length === 0 && spot.sourceText) quotes.push({ text: spot.sourceText, who: proposerNames[0] ?? '' });

  const out: SpotDetail = {
    status,
    eyebrow,
    sub,
    cells,
    proposerNames,
    proposers,
    quotes,
    stayMin: spot.stayMin,
    stayEdited: spot.edited.stayMin != null,
    pinned: spot.pinned,
    hostDropped: spot.hostPick === 'drop',
  };
  if (spot.fixedDate) out.fixedDate = spot.fixedDate;
  if (move) out.move = move;
  if (excluded) out.excluded = excluded;
  if (at) {
    out.date = at.date;
    out.item = at.item;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 07 정보 목록과 아래 버튼                                               */
/* ------------------------------------------------------------------ */

export type DetailRowKey = 'stay' | 'date' | 'move' | 'arrive';

export interface DetailRow {
  key: DetailRowKey;
  label: string;
  value: string;
  /** 누르면 시트가 열리는 줄(체류·날짜). 이동과 배치 시각은 읽기 전용이다 */
  editable: boolean;
}

/**
 * 07 정보 칸을 키-값 목록(ListRow)으로(순수). 체류와 날짜는 늘 있고 눌러서 바꾼다.
 * 기점에서 오는 이동과 배치 시각은 있을 때만, 읽기 전용이다. 날짜는 '10/18 토'로 적는다.
 */
export function detailRows(detail: SpotDetail): DetailRow[] {
  const rows: DetailRow[] = [
    { key: 'stay', label: detail.stayEdited ? '체류' : '기본 체류', value: `${detail.stayMin}분`, editable: true },
    {
      key: 'date',
      label: '날짜',
      value: detail.fixedDate
        ? `${daySegLabel(detail.fixedDate)} 지정`
        : detail.date
          ? `자동 배분 · ${daySegLabel(detail.date)}`
          : '자동 배분',
      editable: true,
    },
  ];
  if (detail.move) rows.push({ key: 'move', label: '기점에서', value: detail.move, editable: false });
  if (detail.item) rows.push({ key: 'arrive', label: '배치 시각', value: detail.item.arrive, editable: false });
  return rows;
}

/**
 * 07 '투표' 카드(2026-10-17 사용자 요청, 순수). 표 수가 제외 순서를 정하고, 활성 멤버 과반이 표를 주면 고정 취급한다.
 * 방장 결정(hostPick)이 있으면 표보다 앞선다. 방장은 이 카드에서 '투표대로 · 꼭 넣기 · 빼기'를 고른다(HOST_PICKS).
 */
export interface VoteInfo {
  votes: number;
  active: number;
  /** 자동 고정에 필요한 표 수(과반) */
  need: number;
  byVote: boolean;
  hostPick?: HostPick;
  text: string;
}

export function voteInfo(trip: Trip, spot: Spot): VoteInfo {
  const active = activeMembers(trip);
  const votes = spotVoterIds(spot, active).length;
  const need = Math.floor(active.length / 2) + 1;
  const byVote = votePinned(spot, active);
  const base = { votes, active: active.length, need, byVote, hostPick: spot.hostPick };
  if (spot.hostPick === 'keep') return { ...base, text: '방장이 꼭 넣기로 정했어요. 표와 상관없이 일정에 들어가요' };
  if (spot.hostPick === 'drop') return { ...base, text: '방장이 빼기로 정했어요. 표와 상관없이 일정에서 빠져요' };
  if (active.length < 2) return { ...base, text: `표 ${votes} · 혼자인 방은 투표로 고정하지 않아요` };
  if (byVote) return { ...base, text: `표 ${votes}/${active.length} · 과반이라 고정 취급해요` };
  return { ...base, text: `표 ${votes}/${active.length} · ${need}표가 되면 자동으로 고정돼요. 표가 적을수록 먼저 빠져요` };
}

/** 방장 결정 고르기. null은 '투표대로'(방장 결정 없음) */
export const HOST_PICKS: readonly { pick: HostPick | null; label: string }[] = [
  { pick: null, label: '투표대로' },
  { pick: 'keep', label: '꼭 넣기' },
  { pick: 'drop', label: '빼기' },
];

export type FootActionKey = 'timetable' | 'pin' | 'unpin' | 'restore';

export interface FootAction {
  key: FootActionKey;
  title: string;
  variant: 'primary' | 'quiet';
}

/**
 * 07 아래 버튼(순수). 주 버튼은 하나뿐이다.
 * - 제외 스팟: primary '고정해서 다시 넣기' 하나(spot/restore는 고정으로 되돌린다). 방장이 뺀 곳(hostDropped)은 버튼이 없다.
 * - 확정·배치 전: 배치됐으면 quiet '시간표에서 보기', 그 옆에 primary '고정하기' 또는 quiet '고정 풀기'.
 */
export function footActions(
  state: { status: SpotDetail['status']; pinned: boolean; hostDropped?: boolean },
  placed: boolean,
): FootAction[] {
  // 방장이 뺀 곳은 방장 결정으로만 돌아온다(투표 카드의 '투표대로'·'꼭 넣기'). 다시 넣기 버튼을 두지 않는다.
  if (state.hostDropped) return [];
  if (state.status === 'excluded') return [{ key: 'restore', title: '고정해서 다시 넣기', variant: 'primary' }];
  const out: FootAction[] = [];
  if (placed) out.push({ key: 'timetable', title: '시간표에서 보기', variant: 'quiet' });
  out.push(
    state.pinned
      ? { key: 'unpin', title: '고정 풀기', variant: 'quiet' }
      : { key: 'pin', title: '고정하기', variant: 'primary' },
  );
  return out;
}

/** 07 예고 문장(체류 시트 안 안내). 체류를 늘리면 무엇이 제외되는지 */
export function stayPreviewText(stayMin: number, newlyExcludedNames: string[]): string {
  if (newlyExcludedNames.length === 0) return `체류를 ${stayMin}분으로 늘려도 새로 빠지는 스팟이 없어요.`;
  return `체류를 ${stayMin}분으로 늘리면 ${josa(newlyExcludedNames.join(', '), '이/가')} 제외 스팟이 돼요.`;
}

/**
 * 07 '후보에서 지우기'(spot/delete) 안내. 채팅·수동·추천 어느 경로로 담긴 후보든 지울 수 있다.
 * 다른 멤버의 제안이 섞여 있으면 그 제안도 함께 지워진다는 것을 확인 문구에 적는다.
 */
export function deleteNotice(spot: Pick<Spot, 'proposals'>, me: string | undefined): { label: string; text: string } {
  const fromChat = spot.proposals.some((p) => p.source === 'chat');
  const others = spot.proposals.filter((p) => p.memberId !== me).length;
  const head = fromChat ? '대화 인식이 잘못 잡은 장소를 지워요.' : '잘못 담은 후보를 지워요.';
  const tail = others > 0 ? ` 다른 멤버 제안 ${others}건도 함께 지워져요.` : '';
  return {
    label: fromChat ? '잘못 잡은 장소라 후보에서 지우기' : '후보에서 지우기',
    text: `${head}${tail} 제안 기록과 말풍선 강조도 함께 사라지고 되돌릴 수 없어요.`,
  };
}
