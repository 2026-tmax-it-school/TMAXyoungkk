import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

import {
  clusterMemberIds,
  clusterName,
  dotsKey,
  fitCoords,
  fitKey,
  focusPadding,
  mapPadding,
  markersKey,
  pickMapEngine,
  pinName,
  polylinesKey,
  userName,
} from '../src/core/map/engine';
import { googleScriptUrl } from '../src/components/map/googleScript';
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

test('화면 맞춤: 제외 스팟은 다른 마커가 있으면 빼고, 제외 스팟만 있으면 넣는다', () => {
  const far = { latitude: 35.7425, longitude: 129.4867 };
  const excluded: MapMarkerInput = { id: 'x', coord: far, kind: 'excluded', title: '감은사지 삼층석탑' };
  const base: MapMarkerInput = { id: 'base', coord: B, kind: 'base', title: '라한셀렉트 경주' };
  assert.deepEqual(fitCoords({ markers: [base, marker('a'), excluded], polylines: [] }), [B, A]);
  assert.deepEqual(fitCoords({ markers: [excluded], polylines: [] }), [far]);
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

/* ---------- 2026-10 지도 테스트에서 찾은 문제의 회귀 테스트 ---------- */

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('화면 맞춤 여백: 구글 표기가 있는 아래를 더 비우고, 짧은 지도에서는 크기의 60%까지 줄인다', () => {
  assert.deepEqual(mapPadding({ width: 390, height: 500 }, {}), { top: 40, right: 40, bottom: 48, left: 40 });
  assert.deepEqual(mapPadding({ width: 390, height: 500 }, { flat: true }), { top: 96, right: 40, bottom: 48, left: 40 });
  assert.deepEqual(mapPadding({ width: 340, height: 126 }, { compact: true }), { top: 16, right: 16, bottom: 30, left: 16 });
  // 228px 높이의 화면 가득 지도: 96+48=144는 228의 60%(136.8)를 넘어 줄어든다
  const short = mapPadding({ width: 390, height: 228 }, { flat: true });
  assert.ok(short.top + short.bottom <= 228 * 0.6, JSON.stringify(short));
  assert.ok(short.top > short.bottom, '위(칩 자리)가 여전히 더 넓다');
  // 크기를 아직 모르면(0) 여백도 0이다(지도가 0으로 쪼그라들지 않게)
  assert.deepEqual(mapPadding({ width: 0, height: 0 }, {}), { top: 0, right: 0, bottom: 0, left: 0 });
});

test('묶음을 눌러 당길 때 여백은 80 이하이고 짧은 지도에서 줄어든다', () => {
  assert.equal(focusPadding({ width: 800, height: 600 }), 80);
  assert.equal(focusPadding({ width: 390, height: 228 }), 45);
  assert.equal(focusPadding({ width: 20, height: 20 }), 8);
});

test('구글 지도 스크립트 주소: 비동기 로딩·콜백·한국어·국내 지역, 키가 없으면 key가 없다', () => {
  const u = new URL(googleScriptUrl('AIza-test&x=1', '__cb'));
  assert.equal(u.origin + u.pathname, 'https://maps.googleapis.com/maps/api/js');
  assert.equal(u.searchParams.get('loading'), 'async');
  assert.equal(u.searchParams.get('callback'), '__cb');
  assert.equal(u.searchParams.get('language'), 'ko');
  assert.equal(u.searchParams.get('region'), 'KR');
  // 키 안의 특수 문자는 주소를 깨지 않는다
  assert.equal(u.searchParams.get('key'), 'AIza-test&x=1');
  assert.equal(new URL(googleScriptUrl('  ', '__cb')).searchParams.has('key'), false);
});

test('핀 읽기 이름은 기본 지도와 같고, 미리보기 묶음은 누를 수 없다고 읽는다', () => {
  assert.equal(pinName({ kind: 'spot', label: '1', title: '불국사' }), '1번 불국사');
  assert.equal(pinName({ kind: 'spot', title: '불국사' }), '불국사');
  assert.equal(pinName({ kind: 'spot', label: '출발', title: '불국사' }), '출발 불국사', '글자 라벨(길찾기)은 번을 붙이지 않는다');
  assert.equal(pinName({ kind: 'base', title: '라한셀렉트 경주' }), '기점 라한셀렉트 경주');
  assert.equal(pinName({ kind: 'excluded', label: '제외', title: '동궁과 월지' }), '제외 스팟 동궁과 월지');
  assert.equal(clusterName(3), '3곳 묶음 · 눌러서 확대');
  assert.equal(clusterName(3, false), '3곳 묶음');
  assert.equal(userName(true), '현재 위치(정확도 낮음)');
  assert.equal(userName(false), '현재 위치');
});

test('내용 키: 새 배열이어도 내용이 같으면 같고, 좌표·순번·점선이 바뀌면 달라진다(지도를 매번 다시 그리지 않는다)', () => {
  const m = [marker('a'), { ...marker('b', B), label: '2' }];
  assert.equal(markersKey(m), markersKey(m.map((x) => ({ ...x }))));
  assert.notEqual(markersKey(m), markersKey([marker('a'), { ...marker('b', B), label: '3' }]));
  const l = [{ id: 'd1', coords: [A, B], color: 'ink' as const }];
  assert.equal(polylinesKey(l), polylinesKey([{ ...l[0], coords: [{ ...A }, { ...B }] }]));
  assert.notEqual(polylinesKey(l), polylinesKey([{ ...l[0], dashed: true }]));
  const d = [{ id: 'p1', coord: A, tone: 'ink' as const }];
  assert.equal(dotsKey(d), dotsKey([{ ...d[0], coord: { ...A } }]));
  assert.notEqual(dotsKey(d), dotsKey([{ ...d[0], coord: B }]));
});

test('묶음 id에서 구성 스팟을 꺼낸다(포커스를 첫 스팟으로 옮길 때 쓴다)', () => {
  assert.deepEqual(clusterMemberIds('cluster:spot_a+spot_b'), ['spot_a', 'spot_b']);
  assert.deepEqual(clusterMemberIds('spot_a'), []);
});

test('바탕 지도 글자는 놓이는 바탕 위에서 4.5:1 이상이다', () => {
  const fill = (feature?: string) =>
    GOOGLE_MAP_STYLE.find((r) => r.featureType === feature && r.elementType === 'labels.text.fill')?.stylers[0].color as string;
  const pairs: [string, string, string][] = [
    ['일반', fill(undefined), '#F4F4F5'],
    ['공원', fill(undefined), '#E2EEE6'],
    ['장소', fill('poi'), '#ECECEE'],
    ['도로', fill('road'), '#FFFFFF'],
    ['고속도로', fill('road'), '#E4E4E7'],
    ['물', fill('water'), '#DCE3EA'],
  ];
  const bad = pairs.filter(([, f, b]) => contrast(f, b) < 4.5).map(([n, f, b]) => `${n} ${f}/${b} ${contrast(f, b).toFixed(2)}`);
  assert.deepEqual(bad, []);
});

test('핀 숫자와 제외 글자는 어느 날짜 색 위에서도 4.5:1 이상이다', () => {
  for (const c of ['ink', 'slate', 'ok', 'warn'] as const) assert.ok(contrast(textC.onAccent, mapC[c]) >= 4.5, c);
  assert.ok(contrast(textC.muted, mapC.excludedPin) >= 4.5);
});

test('지도 위 칩 자리는 StyleSheet로 pointerEvents를 준다(웹에서 인라인이면 지도 조작이 모두 막힌다)', () => {
  const src = readFileSync('src/components/map/parts.tsx', 'utf8');
  assert.match(src, /StyleSheet\.create\(\{\s*overlay: \{[^}]*pointerEvents: 'box-none'/);
  assert.match(src, /<View style=\{styles\.overlay\}>/);
  // 다른 곳에서도 인라인 pointerEvents를 쓰지 않는다
  const inline = /style=\{\{[^}]*pointerEvents/;
  for (const f of ['src/components/map/MapCanvas.tsx', 'src/components/map/GoogleMapView.web.tsx', 'src/components/map/GoogleMapView.tsx']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), inline, f);
  }
});

test('웹 기본 지도(SVG) 누르기: onClick과 함께 onPress: null을 줘야 react-native-svg가 onClick을 지우지 않는다', () => {
  // react-native-svg 15 웹 prepare()는 onPress !== null이면 clean.onClick = props.onPress로 덮어쓴다.
  // onClick만 주면 onPress가 undefined라 클릭 핸들러가 사라져 핀·묶음·지도에서 선택이 웹에서 모두 죽는다(2026-10-10 재현)
  const lib = readFileSync('node_modules/react-native-svg/src/web/utils/prepare.ts', 'utf8');
  assert.match(lib, /if \(onPress !== null\) \{\s*clean\.onClick = props\.onPress;/, '라이브러리 동작이 바뀌면 이 우회를 다시 본다');
  const src = readFileSync('src/components/map/MapCanvas.tsx', 'utf8');
  assert.match(src, /const WEB_CLICK = \(fn: unknown\) => \(\{ onClick: fn, onPress: null \}\)/);
  assert.match(src, /IS_WEB \? WEB_CLICK\(fn\)/, '핀·묶음');
  assert.match(src, /clickMap \? WEB_CLICK\(clickMap\)/, '지도에서 선택');
  assert.doesNotMatch(src, /\{ onClick: (fn|clickMap) \}/, 'onPress: null 없이 onClick만 주는 곳이 없다');
});

test('웹 구글 지도: 핀은 노드를 다시 쓰고, 스크롤 화면 안에서는 cooperative, 타일 시한은 보일 때만 잰다', () => {
  const src = readFileSync('src/components/map/GoogleMapView.web.tsx', 'utf8');
  assert.doesNotMatch(src, /replaceChildren/, '핀을 매번 통째로 갈아 끼우면 포커스와 누르는 중인 핀이 사라진다');
  assert.match(src, /gestureHandling: p\.compact \? 'none' : p\.flat \|\| p\.wheelZoom \? 'greedy' : 'cooperative'/);
  assert.match(src, /document\.visibilityState === 'visible'/);
  assert.match(src, /fail\('tiles'\)/);
  // 이동 점은 화면 읽기에서 숨긴다
  assert.match(src, /aria-hidden/);
});

test('앱 빌드 설정: 웹 키를 앱 키로 대신 쓰지 않고, 키가 있을 때만 플랫폼별로 켠다', () => {
  const req = createRequire(import.meta.url);
  const file = path.resolve('app.config.js');
  const load = (env: Record<string, string | undefined>) => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
    delete req.cache[file];
    try {
      return req(file)({ config: {} });
    } finally {
      process.env = saved;
      delete req.cache[file];
    }
  };
  const mapsPlugin = (c: { plugins: unknown[] }) =>
    (c.plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-maps') as [string, Record<string, string>])[1];

  const webOnly = load({ EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'AIza-web', GOOGLE_MAPS_ANDROID_API_KEY: undefined, GOOGLE_MAPS_IOS_API_KEY: undefined });
  assert.deepEqual(mapsPlugin(webOnly), {});
  assert.equal(webOnly.extra.androidGoogleMaps, false);
  assert.equal(webOnly.extra.iosGoogleMaps, false);

  const both = load({ GOOGLE_MAPS_ANDROID_API_KEY: 'AIza-and', GOOGLE_MAPS_IOS_API_KEY: 'AIza-ios' });
  assert.deepEqual(mapsPlugin(both), { androidGoogleMapsApiKey: 'AIza-and', iosGoogleMapsApiKey: 'AIza-ios' });
  assert.equal(both.extra.androidGoogleMaps, true);
  assert.equal(both.extra.iosGoogleMaps, true);
});

test('앱 구글 지도: 안드로이드 여백에 PixelRatio를 곱하지 않고, 키 없는 빌드는 쓰지 않으며, 실패를 알린다', () => {
  const src = readFileSync('src/components/map/GoogleMapView.tsx', 'utf8');
  assert.doesNotMatch(src, /edgePadding: \{[^}]*\* k/);
  assert.match(src, /edgePadding: mapPadding\(/);
  assert.match(src, /export const GOOGLE_VIEW_READY = Platform\.OS === 'android' \? IN_EXPO_GO \|\| extra\.androidGoogleMaps === true : true/);
  assert.match(src, /onFail\.current\('tiles'\)/);
  assert.match(src, /lineCap=\{l\.dashed \? 'butt' : 'round'\}/);
});
