import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DAY_COLORS, mapC, NON_TEXT_PAIRS, surfaceC, TEXT_ON_SURFACE_PAIRS, textC } from '../src/ui/tokens';

/**
 * 대비(WCAG 2.x 상대 휘도). 본문 4.5:1, 24px 이상 3:1. 날짜별 선 색은 지도 바탕 위 3:1 이상.
 * 2026-09-29 화이트 개편 토큰 기준(주색은 2026-10-10 리디자인에서 진한 연두로 바뀜). 새 조합은 TEXT_ON_SURFACE_PAIRS에 넣으면 여기서 자동으로 검사된다.
 */

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test('개편 토큰 기준값을 재현한다(계산식 확인)', () => {
  // 2026-10-10 Young Trip 디자인 시스템: ink #222222, muted #6A6A6A, soft #F7F7F7
  assert.equal(contrast(textC.ink, surfaceC.card).toFixed(2), '15.91');
  assert.equal(contrast(textC.muted, surfaceC.card).toFixed(2), '5.41');
  assert.equal(contrast(textC.muted, surfaceC.soft).toFixed(2), '5.05');
  assert.equal(contrast(textC.accentStrong, surfaceC.soft).toFixed(2), '14.85');
  assert.equal(contrast(mapC.ink, mapC.bg).toFixed(2), '17.18');
  assert.equal(contrast(mapC.slate, mapC.bg).toFixed(2), '5.94');
  assert.equal(contrast(mapC.ok, mapC.bg).toFixed(2), '5.73');
  assert.equal(contrast(mapC.warn, mapC.bg).toFixed(2), '5.39');
});

test('글자·면 조합은 본문 4.5:1(큰 글자 3:1) 이상이다', () => {
  const fails = TEXT_ON_SURFACE_PAIRS.map((p) => ({ ...p, ratio: contrast(textC[p.text], surfaceC[p.surface]) })).filter(
    (p) => p.ratio < (p.large ? 3 : 4.5),
  );
  assert.deepEqual(
    fails.map((f) => `${f.text} on ${f.surface} = ${f.ratio.toFixed(2)}`),
    [],
  );
});

test('faint 색(#A1A1AA)은 글자색에 없다', () => {
  const values = Object.values(textC).map((v) => v.toUpperCase());
  assert.equal(values.includes('#A1A1AA'), false);
});

test('날짜별 선 색은 잉크·청회색·초록·앰버 순이고 지도 바탕 위 3:1 이상이다', () => {
  assert.deepEqual([...DAY_COLORS], ['ink', 'slate', 'ok', 'warn']);
  for (const c of DAY_COLORS) {
    const r = contrast(mapC[c], mapC.bg);
    assert.ok(r >= 3, `${c} ${r.toFixed(2)}`);
  }
});

test('상태를 알리는 비텍스트 요소(진행 막대 채움·트랙)는 3:1 이상이다(WCAG 1.4.11)', () => {
  assert.ok(NON_TEXT_PAIRS.length >= 1);
  const fails = NON_TEXT_PAIRS.map((p) => ({ ...p, ratio: contrast(surfaceC[p.fg], surfaceC[p.bg]) })).filter(
    (p) => p.ratio < 3,
  );
  assert.deepEqual(
    fails.map((f) => `${f.name} = ${f.ratio.toFixed(2)}`),
    [],
  );
});

test('앱 바탕과 카드는 흰색이고, 주색은 진한 연두 하나다(2026-10-10 리디자인)', () => {
  assert.equal(surfaceC.bg, '#FFFFFF');
  assert.equal(surfaceC.card, '#FFFFFF');
  const hex = surfaceC.accent.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert.ok(g > r && g > b, '주색은 초록 계열(연두)');
  // 주색 면·선·글자가 같은 계열이고 흰 바탕 위 4.5:1 이상이다
  assert.ok(contrast(textC.accent, surfaceC.bg) >= 4.5);
  assert.ok(contrast(textC.onAccent, surfaceC.accent) >= 4.5);
});
