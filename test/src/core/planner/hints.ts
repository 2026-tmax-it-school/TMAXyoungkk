import type { ChatMessage, Spot } from '../../types';
import { DAYPART_EVENING, DAYPART_NOON } from '../constants';
import { toMin } from '../util';

/**
 * 채팅 속 시간 힌트(WP4 소유, 순수). 2026-10-22 셀프 QA: "동궁과월지 야경 보자"로 담긴 곳이 오전 09:00에 놓였다.
 * 스팟을 담은 원문(sourceText)과 제안 메시지에서 그 장소 이름 둘레의 낱말만 본다.
 * 저장하지 않는다. 계산할 때 plannedSpots가 붙이고 순서·도착 시각에만 쓴다(수동 순서·도착 지정이 있으면 그쪽이 먼저).
 */
export type TimeHint = 'morning' | 'lunch' | 'evening';

const RULES: { hint: TimeHint; re: RegExp }[] = [
  { hint: 'evening', re: /야경|야간|밤에|밤바다|저녁|노을|일몰|석양|선셋|불빛|조명/ },
  { hint: 'lunch', re: /점심|런치|낮밥/ },
  { hint: 'morning', re: /아침|일출|해돋이|새벽|오전|모닝/ },
];

/** 장소 이름 앞뒤로 이만큼(글자)만 본다. 한 메시지에 여러 곳이 나오면 이웃 장소 힌트가 넘어오지 않게 */
const WINDOW = 14;

const squash = (s: string) => s.replace(/\s+/g, '');

/** 한 문장에서 이 장소의 힌트. 이름 둘레에 낱말이 여럿이면 이름에 가장 가까운 것. 이름이 문장에 없으면 문장 전체에서 처음 것 */
export function hintInText(text: string, name: string, others: readonly string[] = []): TimeHint | undefined {
  const t = squash(text);
  const n = squash(name);
  const at = n ? t.indexOf(n) : -1;
  if (at < 0) return RULES.find((r) => r.re.test(t))?.hint;
  let from = Math.max(0, at - WINDOW);
  let to = at + n.length + WINDOW;
  // 다른 장소 이름을 넘어가지 않고, 낱말이 다른 장소 이름에 더 가까우면 그 장소 것으로 본다
  // ("불국사 보고 저녁엔 동궁과월지"의 저녁은 동궁과월지 것)
  const spans: { s: number; e: number }[] = [];
  for (const o of others) {
    const on = squash(o);
    if (!on || on === n) continue;
    for (let k = t.indexOf(on); k >= 0; k = t.indexOf(on, k + 1)) {
      spans.push({ s: k, e: k + on.length });
      if (k + on.length <= at) from = Math.max(from, k + on.length);
      else if (k >= at + n.length) to = Math.min(to, k);
    }
  }
  const distTo = (a: { s: number; e: number }, b: { s: number; e: number }) => (b.e <= a.s ? a.s - b.e : b.s >= a.e ? b.s - a.e : 0);
  const self = { s: at, e: at + n.length };
  let best: { hint: TimeHint; dist: number } | undefined;
  for (const r of RULES) {
    const re = new RegExp(r.re.source, 'g');
    for (let m = re.exec(t); m; m = re.exec(t)) {
      const word = { s: m.index, e: m.index + m[0].length };
      if (word.e <= from || word.s >= to) continue;
      const dist = distTo(self, word);
      if (spans.some((o) => distTo(o, word) < dist)) continue;
      if (!best || dist < best.dist) best = { hint: r.hint, dist };
    }
  }
  return best?.hint;
}

/** 스팟의 힌트. 원문을 먼저, 그다음 제안 메시지를 본다. others는 같은 여행방의 다른 장소 이름 */
export function spotTimeHint(spot: Spot, messages: readonly ChatMessage[], others: readonly string[] = []): TimeHint | undefined {
  const texts: string[] = [];
  if (spot.sourceText) texts.push(spot.sourceText);
  for (const p of spot.proposals) {
    const m = p.messageId ? messages.find((x) => x.id === p.messageId) : undefined;
    if (m) texts.push(m.text);
  }
  for (const t of texts) {
    const h = hintInText(t, spot.name, others);
    if (h) return h;
  }
  return undefined;
}

/** 이 힌트면 이 시각 전에는 도착하지 않게 기다린다(분). 아침은 기다리지 않는다 */
export function hintEarliestMin(hint: TimeHint | undefined): number | undefined {
  if (hint === 'evening') return toMin(DAYPART_EVENING);
  if (hint === 'lunch') return toMin(LUNCH_FROM);
  return undefined;
}

/** 힌트 시간대(분). 이 밖에 도착하면 순서를 다시 본다 */
export function hintWindow(hint: TimeHint): { from: number; to: number } {
  if (hint === 'morning') return { from: 0, to: toMin(DAYPART_NOON) };
  if (hint === 'lunch') return { from: toMin(LUNCH_FROM), to: toMin(LUNCH_TO) };
  return { from: toMin(DAYPART_EVENING), to: 24 * 60 };
}

export const LUNCH_FROM = '11:30';
export const LUNCH_TO = '13:30';
