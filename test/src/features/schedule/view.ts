import type { DayPlan, Plan, PlanDiff, PlanStep, Transport, Trip, Visit } from '../../types';
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
    if (s && key === 'matrix' && s.total > 0) row.count = `${s.done}구간`;
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
      if (s && s.total > 0 && r.key !== 'matrix') v += Math.min(1, s.done / s.total);
    }
  }
  return v / rows.length;
}

/** 선별 규칙 전문(08). 06·07 문구와 같은 규칙이다. */
export const SELECTION_RULES: string[] = [
  '수용량을 넘으면 제안자가 적은 곳부터 뺍니다. 같으면 늦게 등록된 곳을 뺍니다.',
  '고정한 곳과 날짜를 지정한 곳은 빠지지 않습니다. 순서만 바꾼 곳은 넘치면 같은 규칙으로 빠집니다. 고정만으로 넘치면 넘친 시간을 알려 드립니다.',
  '하루 수용량은 활동시간에서 이동 시간을 뺀 값입니다. 가까운 곳끼리 같은 날에 묶습니다.',
  '제외 스팟에는 이유를 붙입니다. 기점 왕복이 1시간 이상이면 거리를, 아니면 꽉 찬 날을 적습니다.',
  '확정 버튼은 없습니다. 후보가 바뀌면 다시 계산합니다.',
];

export function planMeta(trip: Trip, plan: Plan | undefined, date?: string): string[] {
  const out: string[] = [];
  if (plan) {
    const cache = plan.cacheHits > 0 ? ` · 캐시 ${plan.cacheHits}건` : '';
    out.push(`경로 조회 ${plan.routeCalls}건${cache} · ${TRANSPORT_LABEL[trip.transport]} 기준`);
  }
  const day = plan?.days.find((d) => d.date === date) ?? plan?.days[0];
  if (day) {
    const base = day.baseSource === 'firstSpot' ? '기점 없음(첫 스팟에서 시작)' : `기점 ${day.base?.name ?? ''}`;
    out.push(`${base} · 활동시간 ${toHHMM(day.startMin)}–${toHHMM(day.endLimitMin)}`);
  }
  if (plan?.estimated) out.push('일부 구간은 직선거리로 추정했습니다');
  return out;
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

export function daySummary(day: DayPlan): string {
  if (day.items.length === 0) return '확정 스팟 없음';
  const end = toHHMM(day.startMin + day.usedMin);
  const over = day.overMin > 0 ? ` · ${humanMin(day.overMin)} 초과` : '';
  return `${day.items.length}곳 · ${toHHMM(day.startMin)}–${end}${over}`;
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

export function deltaChip(delta: number | null): { text: string; tone: 'warn' | 'ok' | 'soft' } | undefined {
  if (delta === null) return undefined;
  if (delta > 0) return { text: `+${humanMin(delta)}`, tone: 'warn' };
  if (delta < 0) return { text: `-${humanMin(-delta)}`, tone: 'ok' };
  return { text: '같음', tone: 'soft' };
}
