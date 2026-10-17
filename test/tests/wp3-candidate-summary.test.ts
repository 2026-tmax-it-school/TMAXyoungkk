import assert from 'node:assert/strict';
import { test } from 'node:test';

import { candidateView, type CandidateView } from '../src/features/candidates/rows';
import { summaryLine } from '../src/features/candidates/summary';
import { scenarioTrip } from './helpers/fixtures';
import { read } from './setup/scan';

/** 후보 요약 한 줄(summaryLine). 후보 탭 머리말과 채팅 입력줄 위 후보 줄이 같이 쓴다. */

function view(p: Partial<CandidateView>): CandidateView {
  return {
    total: 0,
    confirmed: [],
    excluded: [],
    pending: [],
    autoExcluded: 0,
    capacityExcluded: 0,
    otherExcluded: 0,
    overCapacity: [],
    ...p,
  };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ spotId: `s${i}` })) as never[];

test('계산한 뒤에는 후보·확정·제외 수를 한 줄로', () => {
  assert.equal(summaryLine(view({ total: 14, confirmed: rows(11), excluded: rows(3) })), '후보 14곳 · 확정 11 · 제외 3');
  // 계획 뒤에 새로 담은 곳은 '계산 전'으로 덧붙인다
  assert.equal(
    summaryLine(view({ total: 15, confirmed: rows(11), excluded: rows(3), pending: rows(1) })),
    '후보 15곳 · 확정 11 · 제외 3 · 계산 전 1',
  );
});

test('아직 배치를 계산하지 않았으면 배치 계산 전', () => {
  assert.equal(summaryLine(view({ total: 4, pending: rows(4) })), '후보 4곳 · 배치 계산 전');
  // 시나리오 여행방(계획 없음): 후보 14곳 전부 계산 전
  assert.equal(summaryLine(candidateView(scenarioTrip(), undefined)), '후보 14곳 · 배치 계산 전');
});

test('후보가 없으면 undefined(줄을 숨긴다)', () => {
  assert.equal(summaryLine(view({})), undefined);
});

test('summary.ts는 rows.ts에서 타입만 가져온다', () => {
  const src = read('src/features/candidates/summary.ts');
  assert.match(src, /^import type \{ CandidateView \} from '\.\/rows';/m);
  assert.ok(!/^import \{/m.test(src));
});
