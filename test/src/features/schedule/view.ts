import type { Adjustment, DayPlan, OpDraft, Plan, PlanDiff, PlanStep, Transport, Trip, Visit } from '../../types';
import { TRANSPORT_LABEL } from '../../core/constants';
import { dayShort, humanMin, josa, toHHMM, weekday } from '../../core/util';

/**
 * 08·09·10·12 화면 문구와 행 계산(WP4 소유, 순수). 화면 파일에는 그리기만 남긴다.
 */

/* ---------- 08 루트 계산 중 ---------- */

export type StepState = 'done' | 'active' | 'wait';

export interface StepRow {
  key: PlanStep['key'];
  label: string;
  state: StepState;
  /** '11 / 14' 같은 진행 수 */
  count?: string;
  /** '0.4초'. 재지 않았으면 없다 */
  time?: string;
}

const STEP_ORDER: PlanStep['key'][] = ['locate', 'matrix', 'allocate', 'reasons'];

export function stepLabel(key: PlanStep['key'], candidates: number, hasBase: boolean): string {
  switch (key) {
    case 'locate':
      return `후보 ${candidates}곳 위치 확인`;
    case 'matrix':
      return hasBase ? '기점에서 이동시간 조회' : '스팟 사이 이동시간 조회';
    case 'allocate':
      return '하루 수용량에 맞춰 배치';
    default:
      return '제외 사유 정리';
  }
}

/**
 * 실제 onStep 단계만으로 행을 만든다(가짜 진행률 없음). busy가 아니면 받은 단계는 전부 끝난 것이다.
 * busy면 마지막으로 받은 단계가 진행 중이다. 이동시간 조회는 배치 중에도 다시 올 수 있어 마지막 단계로 판정한다.
 */
export function planningStepRows(steps: readonly PlanStep[], busy: boolean, candidates: number, hasBase: boolean): StepRow[] {
  const seen = STEP_ORDER.filter((k) => steps.some((s) => s.key === k));
  const lastIdx = seen.length ? STEP_ORDER.indexOf(seen[seen.length - 1]) : -1;
  return STEP_ORDER.map((key, i) => {
    const s = steps.find((x) => x.key === key);
    const state: StepState = !s ? 'wait' : busy && i === lastIdx ? 'active' : i <= lastIdx ? 'done' : 'wait';
    const row: StepRow = { key, label: stepLabel(key, candidates, hasBase), state };
    if (s && (key === 'allocate' || key === 'reasons') && s.total > 0) row.count = `${s.done} / ${s.total}`;
    // 이동시간 조회는 구간이 끝날 때마다 done이 오른다(TravelBook.ensure onProgress). 진행 중이면 '37 / 100구간'으로 보인다
    if (s && key === 'matrix' && s.total > 0) row.count = state === 'active' ? `${s.done} / ${s.total}구간` : `${s.done}구간`;
    if (s && state === 'done' && s.ms > 0) row.time = `${(s.ms / 1000).toFixed(1)}초`;
    return row;
  });
}

/** 진행 막대 값. 끝난 단계 수 + 진행 중 단계의 실제 done/total */
export function planningProgress(rows: readonly StepRow[], steps: readonly PlanStep[]): number {
  let v = 0;
  for (const r of rows) {
    if (r.state === 'done') v += 1;
    else if (r.state === 'active') {
      const s = steps.find((x) => x.key === r.key);
      if (s && s.total > 0) v += Math.min(1, s.done / s.total);
    }
  }
  return v / rows.length;
}

const STEP_STATE_LABEL: Record<StepState, string> = { done: '완료', active: '진행 중', wait: '대기' };

/** 08 단계 행의 스크린리더 이름 '후보 14곳 위치 확인, 완료'(표시 모양이 아니라 상태를 말로 읽는다) */
export function stepRowA11y(r: Pick<StepRow, 'label' | 'state'>): string {
  return `${r.label}, ${STEP_STATE_LABEL[r.state]}`;
}

/** 선별 규칙 전문(08). 06·07 문구와 같은 규칙이다. */
export const SELECTION_RULES: string[] = [
  '수용량을 넘으면 제안자가 적은 곳부터 뺍니다. 같으면 늦게 등록된 곳을 뺍니다.',
  '고정한 곳과 날짜를 지정한 곳은 빠지지 않습니다. 순서만 바꾼 곳은 넘치면 같은 규칙으로 빠집니다. 고정만으로 넘치면 넘친 시간을 알려 드립니다.',
  '하루 수용량은 활동시간에서 이동 시간을 뺀 값입니다. 가까운 곳끼리 같은 날에 묶습니다.',
  '제외 스팟에는 이유를 붙입니다. 기점 왕복이 1시간 이상이면 거리를, 아니면 꽉 찬 날을 적습니다.',
  '확정 버튼은 없습니다. 후보가 바뀌면 다시 계산합니다.',
];

/**
 * 08 계산 정보 줄. 수단은 그날 수단(dayTransport: 날짜 설정 → 여행방 기본)이다.
 * 날짜가 없거나 계획에 없는 날이면 계획의 첫날 기준이다.
 */
export function planMeta(trip: Trip, plan: Plan | undefined, date?: string): string[] {
  const out: string[] = [];
  const day = plan?.days.find((d) => d.date === date) ?? plan?.days[0];
  if (plan) {
    const cache = plan.cacheHits > 0 ? ` · 캐시 ${plan.cacheHits}건` : '';
    out.push(`경로 조회 ${plan.routeCalls}건${cache} · ${TRANSPORT_LABEL[dayTransport(trip, day?.date ?? date)]} 기준`);
  }
  if (day) {
    const base = day.baseSource === 'firstSpot' ? '기점 없음(첫 스팟에서 시작)' : `기점 ${day.base?.name ?? ''}`;
    out.push(`${base} · 활동시간 ${toHHMM(day.startMin)}–${toHHMM(day.endLimitMin)}`);
  }
  if (plan?.estimated) out.push('일부 구간은 직선거리로 추정했어요');
  return out;
}

/** 그날 수단: 날짜 설정의 하루 전체 수단, 없으면 여행방 기본 수단(planner/day와 같은 규칙). 구간 지정은 보지 않는다 */
export function dayTransport(trip: Pick<Trip, 'transport' | 'days'>, date?: string): Transport {
  const setting = date ? trip.days.find((d) => d.date === date) : undefined;
  return setting?.transport ?? trip.transport;
}

/** 활동시간 초과 안내(09 Notice, 12 미리보기가 같은 문장을 쓴다). 넘친 원인은 빠지지 않는 곳뿐이다 */
export function overflowCause(overMin: number): string {
  return `고정하거나 날짜를 지정한 곳만으로 활동시간을 ${humanMin(overMin)} 넘깁니다`;
}

/* ---------- 10 일정 편집 ---------- */

/**
 * 10에서 편집한 뒤 새로 자동 제외된 스팟 안내(비기능 선별 품질: 조용한 제외 없음).
 * before는 편집 직전 계획의 제외 스팟 id. 사용자가 직접 뺀 것(userRemoved)은 알리지 않는다(누른 사람이 안다).
 */
export function newlyExcludedLines(before: readonly string[], plan: Plan): string[] {
  const was = new Set(before);
  return plan.excluded
    .filter((e) => !was.has(e.spotId) && (e.reasonCode === 'dayFull' || e.reasonCode === 'tooFar'))
    .map((e) => `${josa(e.name, '이/가')} 제외 스팟이 됐습니다 · ${e.reason}`);
}

/** 10 머리말 보조 줄 '10월 18일 (일) · 4곳 · 5시간 17분'. 계산 중이면 ' · 계산 중'을 붙인다 */
export function editHeaderSub(date: string, day: Pick<DayPlan, 'items' | 'usedMin'>, busy: boolean): string {
  const base = `${dayTitle(date)} · ${day.items.length}곳 · ${humanMin(day.usedMin)}`;
  return busy ? `${base} · 계산 중` : base;
}

/** 10 목록 위 순서 줄. 직접 바꾼 순서면 '직접 정함', 아니면 계산한 '이동 짧은 순' */
export function editOrderLabel(day: Pick<DayPlan, 'orderMethod'>): string {
  return day.orderMethod === 'manual' ? '순서 · 직접 정함' : '순서 · 이동 짧은 순';
}

/**
 * 10 편집 토스트. 카드가 이 날에서 사라지는 편집(다른 날로 옮기기, 빼기)만 알린다('불국사를 10/19로 옮겼어요').
 * 자동 날짜(null)나 같은 날 지정은 카드가 남을 수 있어 알리지 않는다.
 */
export function editToast(trip: Pick<Trip, 'spots'>, date: string, drafts: readonly OpDraft[]): string | undefined {
  const name = (id: string) => trip.spots.find((s) => s.id === id)?.name ?? id;
  for (const d of drafts) {
    if (d.type === 'schedule/setDate' && d.date && d.date !== date) {
      return `${josa(name(d.spotId), '을/를')} ${josa(dayShort(d.date), '으로/로')} 옮겼어요`;
    }
    if (d.type === 'spot/remove') return `${josa(name(d.spotId), '을/를')} 뺐어요. 후보에서 되돌릴 수 있어요`;
  }
  return undefined;
}

/** 10 조정안 적용 토스트. 옮기기·빼기는 editToast, 체류 줄이기는 '대릉원 체류를 60분으로 줄였어요' */
export function adjustmentToast(trip: Pick<Trip, 'spots'>, date: string, a: Pick<Adjustment, 'kind' | 'label' | 'ops'>): string {
  const moved = editToast(trip, date, a.ops);
  if (moved) return moved;
  return a.kind === 'shortenStay' ? `${a.label} 줄였어요` : `${a.label} 적용했어요`;
}

/** 조정안 '빼기'의 스팟 이름(확인 시트 제목). 빼기가 아니면 없다 */
export function excludeTarget(trip: Pick<Trip, 'spots'>, a: Pick<Adjustment, 'kind' | 'ops'>): string | undefined {
  if (a.kind !== 'exclude') return undefined;
  const op = a.ops.find((o) => o.type === 'spot/remove');
  if (!op || op.type !== 'spot/remove') return undefined;
  return trip.spots.find((s) => s.id === op.spotId)?.name ?? op.spotId;
}

/** 10 목록 맨 위 초과 WarnCard의 제목과 문장 */
export function editOverflow(
  date: string,
  day: Pick<DayPlan, 'startMin' | 'usedMin' | 'endLimitMin' | 'overMin'>,
): { title: string; text: string } {
  return {
    title: `${dayShort(date)} 수용량을 ${humanMin(day.overMin)} 넘었어요`,
    text: `이대로 두면 ${toHHMM(day.startMin + day.usedMin)}에 끝나 활동시간(${toHHMM(day.endLimitMin)}까지)을 넘어요. 조정안을 누르면 바로 적용해요.`,
  };
}

/* ---------- 09 시간표 ---------- */

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** '10월 18일' */
export function monthDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일`;
}

/** '10월 18일 (일)' */
export function dayTitle(date: string): string {
  return `${monthDay(date)} (${WEEK[weekday(date)]})`;
}

/** 날짜 Seg 라벨 '10/18 일' */
export function daySegLabel(date: string): string {
  return `${dayShort(date)} ${WEEK[weekday(date)]}`;
}

/**
 * 09 요약 줄 '4곳 · 09:00–14:17'. 넘친 시간은 채움 막대('1시간 30분 넘어요')와 WarnCard가 말하므로 여기 붙이지 않는다
 * (요약 줄은 높이 고정 한 줄이라 360px에서 끝 시각이 잘리지 않게 짧게 둔다)
 */
export function daySummary(day: Pick<DayPlan, 'items' | 'startMin' | 'usedMin'>): string {
  if (day.items.length === 0) return '확정 스팟 없음';
  const end = toHHMM(day.startMin + day.usedMin);
  return `${day.items.length}곳 · ${toHHMM(day.startMin)}–${end}`;
}

/** 09 초과 WarnCard 문장. 제목('활동시간을 1시간 넘어요')의 시간을 되풀이하지 않고 까닭과 고칠 길만 말한다 */
export function scheduleOverflowText(): string {
  return '고정하거나 날짜를 지정한 곳만으로도 활동시간이 모자라요. 조정안으로 체류를 줄이거나 다른 날로 옮길 수 있어요.';
}

/** 10 도구 카드 도착 Stepper 아래 링크: 지정이 없을 때 계산된 도착 시각을 그대로 한 번에 지정한다 */
export function arrivePinText(arrive: string): string {
  return `${arrive} 그대로 지정`;
}

/** 09 채움 막대. value는 활동시간 중 쓴 몫(0~1), text는 막대 옆 한 줄 */
export interface DayFill {
  value: number;
  over: boolean;
  text: string;
}

/** 하루를 얼마나 채웠는지(09 요약 줄 아래 막대). 넘치면 막대는 가득이고 넘친 시간을, 아니면 남은 시간을 적는다 */
export function dayFill(day: Pick<DayPlan, 'usedMin' | 'capacityMin' | 'overMin'>): DayFill {
  const cap = day.capacityMin;
  const value = cap > 0 ? Math.max(0, Math.min(1, day.usedMin / cap)) : day.usedMin > 0 ? 1 : 0;
  if (day.overMin > 0) return { value: 1, over: true, text: `${humanMin(day.overMin)} 넘어요` };
  const left = Math.max(0, cap - day.usedMin);
  return { value, over: false, text: left > 0 ? `${humanMin(left)} 남아요` : '꽉 찼어요' };
}

/** 활동시간 '활동 09:00–21:00'. 계획이 있으면 계산한 값, 없으면 날짜 설정 → 여행방 기본 */
export function activityText(
  trip: Pick<Trip, 'dayStart' | 'dayEnd' | 'days'>,
  date: string,
  day?: Pick<DayPlan, 'startMin' | 'endLimitMin'>,
): string {
  if (day) return `활동 ${toHHMM(day.startMin)}–${toHHMM(day.endLimitMin)}`;
  const setting = trip.days.find((d) => d.date === date);
  return `활동 ${setting?.dayStart ?? trip.dayStart}–${setting?.dayEnd ?? trip.dayEnd}`;
}

export const VISIT_LABEL: Record<Visit['status'], string> = {
  arrived: '도착',
  skipped: '지나침',
  cancelled: '도착 취소',
};

export function legLabel(t: Transport, minutes: number, estimated: boolean): string {
  return `${TRANSPORT_LABEL[t]} ${humanMin(minutes)}${estimated ? ' · 추정' : ''}`;
}

/* ---------- 12 이동수단 ---------- */

/** '바꾸면 이렇게 됩니다' 문장. diff는 previewOps 결과 */
export function previewSentence(trip: Trip, date: string, transport: Transport, diff: PlanDiff): string {
  const name = (id: string) => trip.spots.find((s) => s.id === id)?.name ?? id;
  const d = diff.dayDelta.find((x) => x.date === date);
  const label = TRANSPORT_LABEL[transport];
  const parts: string[] = [];
  const delta = d?.usedMinDelta ?? 0;
  if (delta > 0) parts.push(`${josa(label, '으로/로')} 바꾸면 ${josa(dayShort(date), '이/가')} ${humanMin(delta)} 늘어납니다`);
  else if (delta < 0) parts.push(`${josa(label, '으로/로')} 바꾸면 ${josa(dayShort(date), '이/가')} ${humanMin(-delta)} 줄어듭니다`);
  else if (diff.newlyExcluded.length || diff.newlyConfirmed.length) parts.push(`${josa(label, '으로/로')} 바꾸면 ${dayShort(date)}에 들어가는 곳이 달라집니다`);
  else parts.push(`${josa(label, '으로/로')} 바꿔도 ${dayShort(date)} 시간은 그대로입니다`);
  if (d && d.overMin > 0) parts.push(overflowCause(d.overMin));
  if (diff.newlyExcluded.length) {
    const names = diff.newlyExcluded.map(name).join(', ');
    parts.push(`${josa(names, '이/가')} 제외 스팟이 됩니다`);
  }
  if (diff.newlyConfirmed.length) {
    const names = diff.newlyConfirmed.map(name).join(', ');
    parts.push(`${josa(names, '이/가')} 확정 스팟으로 돌아옵니다`);
  }
  if (!diff.newlyExcluded.length && !diff.newlyConfirmed.length) parts.push('확정·제외는 바뀌지 않습니다');
  return `${parts.join('. ')}.`;
}

export interface PreviewChip {
  text: string;
  tone: 'warn' | 'ok' | 'soft' | 'line';
}

/**
 * 12 미리보기 표 한 줄의 칩(이 구간만, 이날 전체). diff는 previewOps 결과.
 * 그날 시간 차이(+분 warn, -분 ok, 같으면 soft) → 활동시간 초과 → 새로 빠지는 곳 → 돌아오는 곳 순서다.
 * 확정·제외가 그대로면 '확정·제외 그대로'를 붙인다. 이름은 한 곳일 때만 적고 여러 곳이면 수로 적는다.
 */
export function legPreviewChips(trip: Pick<Trip, 'spots'>, date: string, diff: PlanDiff): PreviewChip[] {
  const name = (id: string) => trip.spots.find((s) => s.id === id)?.name ?? id;
  const many = (ids: readonly string[]) => (ids.length === 1 ? name(ids[0]) : `${ids.length}곳`);
  const d = diff.dayDelta.find((x) => x.date === date);
  const delta = d?.usedMinDelta ?? 0;
  const out: PreviewChip[] = [
    delta > 0
      ? { text: `+${humanMin(delta)}`, tone: 'warn' }
      : delta < 0
        ? { text: `-${humanMin(-delta)}`, tone: 'ok' }
        : { text: '시간 그대로', tone: 'soft' },
  ];
  if (d && d.overMin > 0) out.push({ text: `활동시간 ${humanMin(d.overMin)} 넘어요`, tone: 'warn' });
  if (diff.newlyExcluded.length) out.push({ text: `${many(diff.newlyExcluded)} 빠져요`, tone: 'warn' });
  if (diff.newlyConfirmed.length) out.push({ text: `${many(diff.newlyConfirmed)} 돌아와요`, tone: 'ok' });
  if (!diff.newlyExcluded.length && !diff.newlyConfirmed.length) out.push({ text: '확정·제외 그대로', tone: 'line' });
  return out;
}

/** 12 Foot 버튼 문구('이 구간만 도보로 바꾸기', '이날 전체를 도보로') */
export function legApplyLabels(t: Transport): { leg: string; day: string } {
  const to = josa(TRANSPORT_LABEL[t], '으로/로');
  return { leg: `이 구간만 ${to} 바꾸기`, day: `이날 전체를 ${to}` };
}

/** 12 적용 뒤 토스트 한 문장 */
export function legAppliedToast(scope: 'leg' | 'day', t: Transport): string {
  const to = josa(TRANSPORT_LABEL[t], '으로/로');
  return scope === 'leg' ? `이 구간을 ${to} 바꿨어요` : `이날 전체를 ${to} 바꿨어요`;
}

export function deltaChip(delta: number | null): { text: string; tone: 'warn' | 'ok' | 'soft' } | undefined {
  if (delta === null) return undefined;
  if (delta > 0) return { text: `+${humanMin(delta)}`, tone: 'warn' };
  if (delta < 0) return { text: `-${humanMin(-delta)}`, tone: 'ok' };
  return { text: '같음', tone: 'soft' };
}
