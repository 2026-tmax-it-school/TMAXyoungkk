import type { ExcludedSpot, Plan, Spot, TimetableItem, Transport, Trip } from '../../types';
import { TRANSPORT_LABEL } from '../../core/constants';
import { memberById } from '../../core/group';
import { proposerIds } from '../../core/spotUtil';
import { daysBetween, dayShort, josa } from '../../core/util';
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
  if (fromBase != null) cells.push({ label: '기점에서', value: `${TRANSPORT_LABEL[transport]} ${Math.round(fromBase)}분` });
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

  const out: SpotDetail = { status, eyebrow, sub, cells, proposerNames, proposers, quotes };
  if (excluded) out.excluded = excluded;
  if (at) {
    out.date = at.date;
    out.item = at.item;
  }
  return out;
}

/** 07 예고 문장. 체류를 늘리면 무엇이 제외되는지 */
export function stayPreviewText(stayMin: number, newlyExcludedNames: string[]): string {
  if (newlyExcludedNames.length === 0) return `체류를 ${stayMin}분으로 늘려도 새로 빠지는 스팟이 없습니다.`;
  return `체류를 ${stayMin}분으로 늘리면 ${josa(newlyExcludedNames.join(', '), '이/가')} 제외 스팟이 됩니다.`;
}

/**
 * 07 '후보에서 지우기'(spot/delete) 안내. 채팅·수동·추천 어느 경로로 담긴 후보든 지울 수 있다.
 * 다른 멤버의 제안이 섞여 있으면 그 제안도 함께 지워진다는 것을 확인 문구에 적는다.
 */
export function deleteNotice(spot: Pick<Spot, 'proposals'>, me: string | undefined): { label: string; text: string } {
  const fromChat = spot.proposals.some((p) => p.source === 'chat');
  const others = spot.proposals.filter((p) => p.memberId !== me).length;
  const head = fromChat ? '대화 인식이 잘못 잡은 장소를 지웁니다.' : '잘못 담은 후보를 지웁니다.';
  const tail = others > 0 ? ` 다른 멤버 제안 ${others}건도 함께 지워집니다.` : '';
  return {
    label: fromChat ? '잘못 잡은 장소라 후보에서 지우기' : '후보에서 지우기',
    text: `${head}${tail} 제안 기록과 말풍선 강조도 함께 사라지고 되돌릴 수 없습니다.`,
  };
}
