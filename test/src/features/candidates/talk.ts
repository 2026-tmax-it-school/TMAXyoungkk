import { activeMembers } from '../../core/group';
import { spotTimeHint, type TimeHint } from '../../core/planner/hints';
import { spotVoterIds } from '../../core/spotUtil';
import { josa } from '../../core/util';
import type { ChatMessage, Spot, Trip } from '../../types';

/**
 * 후보가 어디서 왔는지(2026-10-23 피그마 최종안 B안·C안, 순수). 06 후보 카드·07 스팟 상세가 이 결과만 그린다.
 * - 누가 꺼냈는지: 첫 제안자 이름과 경로(채팅에서 꺼냄 · 직접 담음). 아바타 색은 멤버 순서(ui/Avatar index)다.
 * - 시간 힌트: 채팅 원문에서 읽은 '저녁에·점심·아침' 같은 말(core/planner/hints). 계산과 같은 규칙이다.
 * - 원문 한 줄: 장소가 처음 나온 메시지(스팟 상세의 '채팅에서 나온 말').
 */

export const HINT_LABEL: Record<TimeHint, string> = {
  morning: '오전 추천',
  lunch: '점심 무렵',
  evening: '저녁 추천',
};

export interface SpotWho {
  name: string;
  /** 멤버 순서(아바타 색) */
  index: number;
  text: string;
}

function memberAt(trip: Trip, memberId: string): { name: string; index: number } | undefined {
  const index = trip.members.findIndex((m) => m.id === memberId);
  if (index < 0) return undefined;
  return { name: trip.members[index].nickname, index };
}

/** 처음 꺼낸 사람. 제안이 없으면 없음 */
export function spotWho(trip: Trip, spot: Spot): SpotWho | undefined {
  const first = [...spot.proposals].sort((a, b) => a.at - b.at)[0];
  if (!first) return undefined;
  const m = memberAt(trip, first.memberId);
  if (!m) return undefined;
  const how = first.source === 'chat' ? '채팅에서 꺼냄' : '직접 담음';
  return { ...m, text: `${josa(m.name, '이/가')} ${how}` };
}

/** 채팅 속 시간 힌트 라벨. 다른 장소 이름에 붙은 말은 그 장소 몫이다 */
export function spotHintLabel(trip: Trip, spot: Spot): string | undefined {
  const others = trip.spots.filter((s) => s.id !== spot.id).map((s) => s.name);
  const hint = spotTimeHint(spot, trip.messages, others);
  return hint ? HINT_LABEL[hint] : undefined;
}

/** 표를 준 활성 멤버 이름(멤버 순서대로) */
export function voterNames(trip: Trip, spot: Spot): string[] {
  const active = activeMembers(trip);
  const ids = new Set(spotVoterIds(spot, active));
  return trip.members.filter((m) => ids.has(m.id)).map((m) => m.nickname);
}

export interface SpotQuote {
  name: string;
  index: number;
  text: string;
  sentAt: number;
}

/** 장소가 처음 나온 채팅 한 줄. 채팅에서 오지 않았으면 없음 */
export function spotQuote(trip: Trip, spot: Spot): SpotQuote | undefined {
  const ids = [spot.sourceMessageId, ...spot.proposals.map((p) => p.messageId)].filter((x): x is string => !!x);
  let msg: ChatMessage | undefined;
  for (const id of ids) {
    msg = trip.messages.find((m) => m.id === id);
    if (msg) break;
  }
  if (!msg) return undefined;
  const m = memberAt(trip, msg.memberId);
  if (!m) return undefined;
  return { ...m, text: msg.text, sentAt: msg.sentAt };
}

/** 원문을 장소 이름 기준으로 나눈다(강조할 조각은 mark). 이름이 없으면 한 조각 */
export function splitMark(text: string, name: string): { text: string; mark: boolean }[] {
  const i = name ? text.indexOf(name) : -1;
  if (i < 0) return [{ text, mark: false }];
  const out = [
    { text: text.slice(0, i), mark: false },
    { text: name, mark: true },
    { text: text.slice(i + name.length), mark: false },
  ];
  return out.filter((p) => p.text.length > 0);
}
