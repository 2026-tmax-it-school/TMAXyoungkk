import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { fitCoords, fitKey, pickMapEngine } from '../src/core/map/engine';
import type { MapMarkerInput } from '../src/core/map/layout';
import { mapPinSvg } from '../src/ui/mapPinSvg';
import { GOOGLE_MAP_STYLE } from '../src/ui/mapStyle';
import { mapC, textC } from '../src/ui/tokens';

/**
 * 구글 지도 어댑터의 순수 부분. 엔진 고르기, 화면 맞춤 좌표, 핀 그림, 바탕 스타일.
 * 지도 SDK 자체는 브라우저·기기에서만 돈다(README 브라우저 확인 절차).
 */

const A = { latitude: 35.8347, longitude: 129.2186 };
const B = { latitude: 35.7902, longitude: 129.3320 };
const marker = (id: string, coord = A): MapMarkerInput => ({ id, coord, kind: 'spot', title: id });

test('키가 있을 때만 구글이고, svg를 고르면 키가 있어도 기본 지도다', () => {
  assert.equal(pickMapEngine({ key: '', override: '' }), 'svg');
  assert.equal(pickMapEngine({ key: '  ', override: '' }), 'svg');
  assert.equal(pickMapEngine({ key: 'AIza-test', override: '' }), 'google');
  assert.equal(pickMapEngine({ key: 'AIza-test', override: ' SVG ' }), 'svg');
  // 키 없는 구글은 ApiProjectMapError로 빈 화면이라 고르지 않는다
  assert.equal(pickMapEngine({ key: '', override: 'google' }), 'svg');
});

test('화면 맞춤: fitTo가 먼저, 없으면 마커와 선, 현재 위치는 둘 다 없을 때만', () => {
  const user = { coord: B };
  assert.deepEqual(fitCoords({ markers: [marker('a')], polylines: [], fitTo: [B] }), [B]);
  assert.deepEqual(fitCoords({ markers: [marker('a')], polylines: [{ id: 'l', coords: [A, B], color: 'ink' }], user }), [A, A, B]);
  assert.deepEqual(fitCoords({ markers: [marker('a')], polylines: [], user }), [A]);
  assert.deepEqual(fitCoords({ markers: [], polylines: [], user }), [B]);
  assert.deepEqual(fitCoords({ markers: [], polylines: [] }), []);
});

test('현재 위치가 움직여도 맞춤 키가 그대로다(지도가 다시 맞춰지지 않는다)', () => {
  const markers = [marker('a'), marker('b', B)];
  const k1 = fitKey(fitCoords({ markers, polylines: [], user: { coord: A } }));
  const k2 = fitKey(fitCoords({ markers, polylines: [], user: { coord: { latitude: 35.8, longitude: 129.25 } } }));
  assert.equal(k1, k2);
  // 1m 안쪽 흔들림은 같은 키
  assert.equal(fitKey([{ latitude: 35.834701, longitude: 129.218601 }]), fitKey([A]));
});

test('핀 그림은 기본 지도와 같은 색·크기다', () => {
  const spot = mapPinSvg({ kind: 'spot', label: '3' });
  assert.match(spot.html, new RegExp(`fill="${mapC.ink}"`));
  assert.match(spot.html, new RegExp(`fill="${textC.onAccent}"`));
  assert.match(spot.html, />3<\/text>/);
  assert.equal(spot.size, 34);
  assert.match(mapPinSvg({ kind: 'spot', label: '1', color: 'slate' }).html, new RegExp(`fill="${mapC.slate}"`));
  assert.ok(mapPinSvg({ kind: 'spot', label: '1', compact: true }).size < spot.size);
  assert.match(mapPinSvg({ kind: 'excluded' }).html, />제외<\/text>/);
  assert.match(mapPinSvg({ kind: 'cluster', count: 4 }).html, />4<\/text>/);
  assert.match(mapPinSvg({ kind: 'user' }).html, new RegExp(`fill="${mapC.user}"`));
  assert.match(mapPinSvg({ kind: 'base' }).html, new RegExp(`stroke="${mapC.ink}" stroke-width="3"`));
  // 순번 없는 후보는 작은 점
  assert.ok(mapPinSvg({ kind: 'spot' }).size < 20);
});

test('핀 글자는 이스케이프하고, 앱용 xml에는 style이 없다', () => {
  const p = mapPinSvg({ kind: 'spot', label: '<b>&' });
  assert.match(p.html, /&lt;b&gt;&amp;/);
  assert.doesNotMatch(p.html, /<b>/);
  assert.match(p.html, /style="/);
  assert.doesNotMatch(p.xml, /style="/);
  for (const spec of [{ kind: 'dot', tone: 'ink' }, { kind: 'dot', tone: 'faint', size: 'md' }] as const) {
    const d = mapPinSvg(spec);
    assert.ok(d.size > 0 && d.size <= 12, `${spec.tone} ${d.size}`);
  }
});

test('바탕 스타일은 무채색 hex만 쓰고 가게·대중교통 아이콘을 끈다', () => {
  const colors: string[] = [];
  for (const r of GOOGLE_MAP_STYLE) for (const s of r.stylers) if (typeof s.color === 'string') colors.push(s.color);
  assert.ok(colors.length > 5);
  for (const c of colors) assert.match(c, /^#[0-9A-F]{6}$/, c);
  const off = (f: string) => GOOGLE_MAP_STYLE.some((r) => r.featureType === f && r.stylers.some((s) => s.visibility === 'off'));
  assert.ok(off('poi.business'));
  assert.ok(off('transit'));
});

test('웹 지도는 mapId 없이 띄운다(mapId가 있으면 바탕 스타일이 무시된다)', () => {
  const src = readFileSync('src/components/map/GoogleMapView.web.tsx', 'utf8');
  assert.doesNotMatch(src, /\bmapId\s*:/);
  assert.match(src, /styles: GOOGLE_MAP_STYLE/);
  // 키가 거부되면 기본 지도로 넘긴다
  assert.match(src, /gm_authFailure/);
});
