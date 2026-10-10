import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { LatLng } from '../src/types';
import { BACK_SLACK_M, makePath, pathLength, pointAtDistance, progressOnPath } from '../src/core/live/legPath';
import { offsetCoord } from '../src/core/sim/track';

/**
 * 13 길찾기 진행률(2026-10-10 리뷰). U턴 길에서는 돌아오는 차선이 출발점 옆을 지나간다.
 * 지난 진행 위치를 넘기지 않으면 진행률이 0.29 → 0으로 튀어 안내 줄이 첫 줄로 돌아갔다.
 */

const A: LatLng = { latitude: 35.8347, longitude: 129.219 };
// 동쪽으로 600m 갔다가 14m 옆 반대 차선으로 돌아와 출발점을 지나 북쪽으로 간다
const uturn = [A, offsetCoord(A, 0, 600), offsetCoord(A, 14, 600), offsetCoord(A, 14, -20), offsetCoord(A, 500, -20)];

test('길찾기 진행률: 지난 위치를 이어 넘기면 U턴 반대 차선에서도 처음으로 튀지 않는다', () => {
  const path = makePath(uturn);
  const total = pathLength(path);
  let prev: number | undefined;
  let worstBack = 0;
  let jumpedWithoutPrev = false;
  for (let d = 0; d <= total; d += 25) {
    const c = pointAtDistance(path, d);
    const on = progressOnPath(path, c, prev);
    assert.ok(on, `${d}m 지점은 길 위다`);
    // GPS 흔들림을 받아 주려고 같은 구간에서 BACK_SLACK_M까지는 뒤로 잡을 수 있다. 그보다 크게 뒤로 가면 안 된다
    if (prev !== undefined) worstBack = Math.max(worstBack, prev - on.alongM);
    // 지난 위치 없이 재면 돌아오는 차선이 출발점 옆을 지날 때 처음으로 튄다(고치기 전 동작)
    const blind = progressOnPath(path, c);
    if (blind && d > 700 && blind.alongM < 100) jumpedWithoutPrev = true;
    prev = on.alongM;
  }
  assert.ok(worstBack <= BACK_SLACK_M, `뒤로 ${worstBack}m`);
  assert.ok(prev !== undefined && total - prev < 25, `끝까지 따라간다(${prev} / ${total})`);
  assert.ok(jumpedWithoutPrev, '이 길은 지난 위치 없이는 처음으로 튀는 길이다(시험 조건 확인)');
});

test('길찾기 화면은 같은 구간의 지난 진행 위치를 progressOnPath에 넘긴다', () => {
  const src = readFileSync('src/screens/NavigateScreen.tsx', 'utf8');
  assert.match(src, /alongRef\.current\?\.key === leg\.key \? alongRef\.current\.alongM : undefined/);
  assert.match(src, /progressOnPath\(roadPath, last\.coord, prev\)/);
  assert.match(src, /alongRef\.current = \{ key: leg\.key, alongM: onRoad\.alongM \}/);
});
