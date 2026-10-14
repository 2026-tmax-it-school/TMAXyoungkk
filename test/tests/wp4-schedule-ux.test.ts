import assert from 'node:assert/strict';
import { test } from 'node:test';

import { read, stripComments } from './setup/scan';

/**
 * 08 루트 계산 · 09 시간표 · 10 일정 편집 · 12 이동수단 비교 배치(UX 점검 B6, 2026-10-12).
 * 순수 함수(editHeaderSub, legApplyLabels, dayFill 등)는 wp4-screens가 고정한다. 여기서는 화면 배치를 소스 규칙으로 고정한다.
 * - 09: 위쪽은 TripBar → PlanSwitch → 날짜 Seg(바깥 ScrollView 없음), 초과는 WarnCard로 10에 보내고, '편집'·'다시 계산'은 quiet
 * - 10: 앞으로·뒤로 IconBtn(끌기 대신 늘 보이는 탭 경로), '빼기'는 확인 1회, Foot은 [되돌리기 quiet] [시간표로]
 * - 12: 머리말 한 줄에 이전·다음 구간, Foot은 주 버튼 '이 구간만', 보조 '이날 전체'
 * - 08: 뒤로는 useBack('Schedule'), 없는 여행방은 NotFound('홈으로')(P3, 막다른 화면 없음)
 */

const schedule = stripComments(read('src/screens/ScheduleScreen.tsx'));
const edit = stripComments(read('src/screens/ScheduleEditScreen.tsx'));
const leg = stripComments(read('src/screens/LegTransportScreen.tsx'));
const planning = stripComments(read('src/screens/PlanningScreen.tsx'));

function block(src: string, open: string, close: string): string {
  const a = src.indexOf(open);
  assert.ok(a >= 0, `${open} 없음`);
  const b = src.indexOf(close, a);
  assert.ok(b > a, `${close} 없음`);
  return src.slice(a, b + close.length);
}

test('09 위쪽: TripBar, PlanSwitch(시간표), 날짜 Seg 순이고 바깥 가로 ScrollView를 두지 않는다', () => {
  const bar = schedule.indexOf('<TripBar />');
  const sw = schedule.indexOf('<PlanSwitch value="Schedule"');
  const seg = schedule.indexOf('<Seg', sw);
  assert.ok(bar >= 0 && sw > bar && seg > sw, 'TripBar → PlanSwitch → Seg');
  assert.match(schedule, /useActiveTrip\(\)/);
  assert.doesNotMatch(schedule, /useCurrentTrip/);
  assert.doesNotMatch(schedule, /<ScrollView[^>]*horizontal/);
});

test("09 초과는 WarnCard로 '일정 편집에서 조정안 보기'에 보내고, '편집'·'다시 계산'은 quiet sm이다", () => {
  assert.match(schedule, /<WarnCard[\s\S]*?label: '일정 편집에서 조정안 보기'/);
  assert.match(schedule, /<Btn title="편집" icon="pen" variant="quiet" size="sm" onPress=\{openEdit\} \/>/);
  assert.match(schedule, /<Btn title="다시 계산" variant="quiet" size="sm" disabled=\{busy\} onPress=\{recalc\} \/>/);
});

test("10 카드: 앞으로·뒤로 IconBtn이 늘 있고 처음과 끝은 끈다. '빼기'는 ConfirmSheet를 한 번 거친다", () => {
  assert.match(edit, /<IconBtn icon="up" label=\{`\$\{it\.name\} 앞으로`\} disabled=\{i === 0\}/);
  assert.match(edit, /<IconBtn icon="down" label=\{`\$\{it\.name\} 뒤로`\} disabled=\{i === items\.length - 1\}/);
  const at = edit.indexOf('confirmLabel="빼기"');
  assert.ok(at >= 0 && edit.lastIndexOf('<ConfirmSheet', at) >= 0, "'빼기' 확인 시트");
  assert.match(edit, /label="도착 시각 지정"/);
  assert.match(edit, /label="고정 · 빠지지 않아요"/);
});

test("10 Foot: [되돌리기 quiet] [시간표로] 두 버튼이고 주 버튼은 '시간표로' 하나다", () => {
  const foot = block(edit, '<Foot>', '</Foot>');
  const btns = foot.match(/<Btn\b[\s\S]*?\/>/g) ?? [];
  assert.equal(btns.length, 2);
  assert.match(btns[0], /title="되돌리기" icon="undo" variant="quiet"/);
  assert.match(btns[1], /title="시간표로"/);
  assert.doesNotMatch(btns[1], /variant=/, '시간표로가 주 버튼');
});

test('12 머리말 한 줄에 이전·다음 구간, Foot은 주 버튼 이 구간만과 보조 이날 전체(quiet sm)', () => {
  assert.match(leg, /size="row"[\s\S]*?<IconBtn icon="back" label="이전 구간"[\s\S]*?<IconBtn icon="right" label="다음 구간"/);
  const foot = block(leg, '<Foot>', '</Foot>');
  assert.match(foot, /<Btn title=\{labels\.leg\} disabled=\{!canApply \|\| sameLeg\}/);
  assert.match(foot, /<Btn title=\{labels\.day\} variant="quiet" size="sm" disabled=\{!canApply \|\| sameDay\}/);
});

test("08 뒤로는 useBack('Schedule'), 없는 여행방은 NotFound('홈으로'), 보조 버튼은 계산이 계속된다고 적는다", () => {
  assert.match(planning, /useBack\('Schedule'\)/);
  assert.match(planning, /<NotFound title="여행방을 찾을 수 없어요" onHome=\{\(\) => navigation\.navigate\('Main', \{ screen: 'Home' \}\)\} \/>/);
  assert.doesNotMatch(planning, /<Empty /);
  assert.match(planning, /'이전 화면으로\(계산은 계속돼요\)'/);
  assert.match(planning, /accessibilityLabel=\{stepRowA11y\(r\)\}/);
});
