import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

import { FIT_MAX_ZOOM, FOCUS_MAX_ZOOM, GROUP_LIST_ZOOM, kakaoLevel, pickMapEngine } from '../src/core/map/engine';
import type { MapMarkerInput } from '../src/core/map/layout';
import {
  bridgeScript,
  buildKakaoHtml,
  escAttr,
  isKakaoBridgeUrl,
  KAKAO_WEBVIEW_BASE_URL,
  KAKAO_WEBVIEW_ORIGINS,
  kakaoNavAction,
  parseKakaoOut,
  safeJson,
  type KakaoPageConfig,
} from '../src/components/map/kakaoHtml';
import {
  KAKAO_CLICK_DELAY_MS,
  KAKAO_LOAD_TIMEOUT_MS,
  KAKAO_TILE_TIMEOUT_MS,
  KAKAO_WHEEL_STEP_PX,
  kakaoScriptUrl,
  wheelZoomStep,
} from '../src/components/map/kakaoScript';
import { buildOverlayItems, centroid, itemSig, OVERLAY_Z, toWireItem } from '../src/components/map/overlayItems';
import { mapPinSvg } from '../src/ui/mapPinSvg';

/**
 * 카카오 바탕 지도(2026-10-10 결정)의 순수 부분. 엔진 고르기, SDK 주소, 배율 변환, 핀 목록, 앱 WebView 페이지와 다리.
 * SDK 자체는 브라우저·기기에서만 돈다. 앱 페이지 스크립트는 가짜 kakao.maps를 넣은 vm에서 다리만 돌려 본다.
 */

const A = { latitude: 35.8347, longitude: 129.2186 };
const B = { latitude: 35.7902, longitude: 129.332 };
const spot = (id: string, coord = A, extra: Partial<MapMarkerInput> = {}): MapMarkerInput => ({ id, coord, kind: 'spot', title: id, ...extra });

test('엔진 고르기: svg 강제, google 강제(구글 키), 카카오 키, 구글 키, 기본 지도', () => {
  const k = 'kakao-js';
  const g = 'AIza-test';
  const cases: [string, string, string, string][] = [
    // kakaoKey, googleKey, override, 기대
    ['', '', '', 'svg'],
    [k, '', '', 'kakao'],
    ['', g, '', 'google'],
    [k, g, '', 'kakao'],
    [k, g, 'svg', 'svg'],
    [k, '', ' SVG ', 'svg'],
    [k, g, 'google', 'google'],
    [k, g, ' Google ', 'google'],
    // 구글 키 없는 google 강제는 카카오로(키 없는 구글은 빈 화면)
    [k, '', 'google', 'kakao'],
    ['', '', 'google', 'svg'],
    [k, g, 'kakao', 'kakao'],
    ['', g, 'kakao', 'google'],
    ['', '', 'kakao', 'svg'],
    ['  ', '  ', '', 'svg'],
    [k, g, 'naver', 'kakao'],
  ];
  for (const [kakaoKey, key, override, want] of cases) {
    assert.equal(pickMapEngine({ kakaoKey, key, override }), want, JSON.stringify({ kakaoKey, key, override }));
  }
  // 예전 호출 모양(카카오 키 없음)은 그대로다
  assert.equal(pickMapEngine({ key: g, override: '' }), 'google');
});

test('SDK 주소: autoload=false, appkey, 추가 라이브러리 없음, 키가 비면 appkey가 없다', () => {
  const u = new URL(kakaoScriptUrl(' js-key&x=1 '));
  assert.equal(u.origin + u.pathname, 'https://dapi.kakao.com/v2/maps/sdk.js');
  assert.equal(u.searchParams.get('autoload'), 'false');
  assert.equal(u.searchParams.get('appkey'), 'js-key&x=1');
  assert.equal(u.searchParams.has('libraries'), false);
  assert.equal(new URL(kakaoScriptUrl('')).searchParams.has('appkey'), false);
  assert.ok(KAKAO_LOAD_TIMEOUT_MS >= 5000 && KAKAO_TILE_TIMEOUT_MS >= 5000);
  assert.equal(KAKAO_CLICK_DELAY_MS, 300);
});

test('배율 변환: 구글 zoom을 카카오 레벨(1 가장 가까움 ~ 14)로', () => {
  assert.equal(kakaoLevel(FIT_MAX_ZOOM), 4);
  assert.equal(kakaoLevel(GROUP_LIST_ZOOM), 2);
  assert.equal(kakaoLevel(FOCUS_MAX_ZOOM), 1);
  assert.equal(kakaoLevel(13), 7);
  assert.equal(kakaoLevel(25), 1);
  assert.equal(kakaoLevel(0), 14);
  // 가까울수록 레벨이 작다
  assert.ok(kakaoLevel(FOCUS_MAX_ZOOM) < kakaoLevel(FIT_MAX_ZOOM));
});

test('핀 목록: 우리 규칙으로 묶고, 기점은 묶지 않으며, 묶음 자리는 구성 좌표 평균이다', () => {
  const base: MapMarkerInput = { id: 'base', coord: B, kind: 'base', title: '숙소' };
  const near = { latitude: A.latitude + 0.0001, longitude: A.longitude };
  const markers = [base, spot('a', A, { label: '1' }), spot('b', near, { label: '2' }), spot('c', B, { label: '3' })];
  const pts: Record<string, { x: number; y: number }> = { a: { x: 100, y: 100 }, b: { x: 105, y: 102 }, c: { x: 300, y: 300 } };
  const items = buildOverlayItems(
    {
      markers,
      dots: [{ id: 'p1', coord: A, tone: 'ink' }],
      user: { coord: B, faint: true },
      compact: false,
      clusterPx: 30,
      pressable: true,
    },
    (m) => pts[m.id] ?? null,
  );
  const keys = items.map((i) => i.key);
  assert.deepEqual(keys.sort(), ['c:cluster:a+b', 'd:p1', 'm:base', 'm:c', 'user'].sort());
  const cluster = items.find((i) => i.kind === 'cluster');
  assert.deepEqual(cluster?.coord, centroid([A, near]));
  assert.equal(cluster?.name, '2곳 묶음 · 눌러서 확대');
  assert.equal(cluster?.action?.type, 'cluster');
  assert.deepEqual(items.find((i) => i.key === 'm:c')?.action, { type: 'marker', id: 'c' });
  assert.equal(items.find((i) => i.key === 'm:base')?.action, undefined, '기점은 누르지 않는다');
  assert.equal(items.find((i) => i.key === 'd:p1')?.name, undefined, '이동 점은 장식');
  assert.equal(items.find((i) => i.key === 'user')?.name, '현재 위치(정확도 낮음)');
  assert.ok(OVERLAY_Z.user > OVERLAY_Z.cluster && OVERLAY_Z.cluster > OVERLAY_Z.pin && OVERLAY_Z.pin > OVERLAY_Z.dot);
});

test('핀 목록: 미리보기 묶음은 누를 수 없고, 누를 핸들러가 없으면 핀도 누를 수 없으며, 투영 전 마커는 뺀다', () => {
  const markers = [spot('a'), spot('b'), spot('c', B)];
  const compact = buildOverlayItems(
    { markers, dots: [], compact: true, clusterPx: 18, pressable: true },
    (m) => (m.id === 'c' ? null : { x: 10, y: 10 }),
  );
  assert.deepEqual(compact.map((i) => i.key), ['c:cluster:a+b']);
  assert.equal(compact[0].action, undefined);
  assert.equal(compact[0].name, '2곳 묶음');
  const still = buildOverlayItems({ markers: [spot('a')], dots: [], compact: false, clusterPx: 30, pressable: false }, () => ({ x: 0, y: 0 }));
  assert.equal(still[0].action, undefined);
});

test('앱으로 보내는 핀은 mapPinSvg 그림과 같은 크기이고, 모양이 같으면 같은 서명이다', () => {
  const [it] = buildOverlayItems({ markers: [spot('a', A, { label: '3' })], dots: [], compact: false, clusterPx: 30, pressable: true }, () => ({ x: 1, y: 1 }));
  const w = toWireItem(it);
  const pin = mapPinSvg({ kind: 'spot', label: '3', color: undefined, compact: false });
  assert.equal(w.html, pin.html);
  assert.equal(w.size, pin.size);
  assert.deepEqual(w.at, [A.latitude, A.longitude]);
  assert.equal(w.press, true);
  assert.equal(w.name, '3번 a');
  assert.equal(w.sig, itemSig({ ...it, coord: B }), '자리만 바뀌면 서명이 같아 노드를 다시 만들지 않는다');
  assert.notEqual(w.sig, itemSig({ ...it, action: undefined }));
});

test('스크립트 안 JSON과 속성은 이스케이프한다(</script>, 줄 구분 문자, 따옴표)', () => {
  const j = safeJson({ s: '</script><b>&\u2028\u2029' });
  assert.doesNotMatch(j, /<|>|\u2028|\u2029/);
  assert.deepEqual(JSON.parse(j), { s: '</script><b>&\u2028\u2029' });
  assert.equal(escAttr(`a"b'<c>&`), 'a&quot;b&#39;&lt;c&gt;&amp;');
  const s = bridgeScript({ t: 'items', items: [{ key: 'm:x', sig: '', z: 3, html: '<svg></svg>', size: 10, press: true, at: [1, 2] }] });
  assert.match(s, /^window\.__ytIn&&window\.__ytIn\(\{.*\}\);true;$/);
  assert.doesNotMatch(s, /<svg/);
});

const PAGE: KakaoPageConfig = {
  appKey: 'js"><script>alert(1)</script>',
  bg: 'BG_TOKEN',
  compact: false,
  center: [35.8562, 129.2247],
  level: 7,
  loadTimeoutMs: 10_000,
  tileTimeoutMs: 10_000,
  clickDelayMs: 300,
};

test('앱 페이지: SDK 주소는 autoload=false·appkey로 속성 이스케이프되고, 설정 JSON은 스크립트를 끊지 못한다', () => {
  const html = buildKakaoHtml(PAGE);
  assert.match(html, /^<!doctype html>/);
  const src = /<script src="([^"]+)" onload="window\.__ytScriptLoaded\(\)" onerror="window\.__ytScriptError\(\)"><\/script>/.exec(html);
  assert.ok(src, 'SDK 스크립트 태그');
  const url = new URL(src[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  assert.equal(url.searchParams.get('autoload'), 'false');
  assert.equal(url.searchParams.get('appkey'), PAGE.appKey);
  // 키는 설정 JSON에 넣지 않는다(주소에만)
  assert.doesNotMatch(html, /alert\(1\)<\/script>/);
  assert.equal((html.match(/<script/g) ?? []).length, 3);
  assert.match(html, /background:BG_TOKEN/);
  // 페이지 스크립트는 오래된 WebView에서도 도는 문법이다(화살표 함수·let·const·템플릿 없음)
  const page = /<script>\s*(\(function\(\)\{[\s\S]*?\}\)\(\);)\s*<\/script>/.exec(html)?.[1] ?? '';
  assert.ok(page.length > 500);
  assert.doesNotMatch(page, /=>|\blet\b|\bconst\b|`/);
  assert.doesNotThrow(() => new vm.Script(page));
});

test('페이지에서 앱으로 메시지는 모양을 확인하고 틀리면 버린다', () => {
  assert.deepEqual(parseKakaoOut('{"t":"ready"}'), { t: 'ready' });
  assert.deepEqual(parseKakaoOut('{"t":"moved"}'), { t: 'moved' });
  assert.deepEqual(parseKakaoOut('{"t":"view","level":3,"points":[[1,2],null,["x",1]]}'), { t: 'view', level: 3, points: [[1, 2], null, null] });
  assert.deepEqual(parseKakaoOut('{"t":"tap","key":"m:a"}'), { t: 'tap', key: 'm:a' });
  assert.deepEqual(parseKakaoOut('{"t":"press","lat":35.1,"lng":129.2}'), { t: 'press', lat: 35.1, lng: 129.2 });
  assert.deepEqual(parseKakaoOut('{"t":"fail","reason":"auth"}'), { t: 'fail', reason: 'auth' });
  for (const bad of ['', 'nope', 'null', '1', '{"t":"fail","reason":"x"}', '{"t":"tap"}', '{"t":"press","lat":"1","lng":2}', '{"t":"view","level":1}', '{"t":"other"}']) {
    assert.equal(parseKakaoOut(bad), undefined, bad);
  }
});

/* ---------- 앱 페이지 스크립트를 가짜 SDK로 돌려 다리를 확인한다 ---------- */

interface Fake {
  sent: unknown[];
  overlays: { opts: Record<string, unknown>; map: unknown; pos: unknown }[];
  lines: Record<string, unknown>[];
  calls: string[];
  listeners: Record<string, ((e?: unknown) => void)[]>;
  ctx: Record<string, unknown> & { __ytIn?: (m: unknown) => void; __ytScriptLoaded?: () => void; __ytScriptError?: () => void };
  timers: (() => void)[];
  /** holdLoad일 때 kakao.maps.load가 붙잡아 둔 콜백 */
  loadCb?: () => void;
}

function runPage(withKakao: boolean, opts: { holdLoad?: boolean } = {}): Fake {
  const f: Fake = { sent: [], overlays: [], lines: [], calls: [], listeners: {}, ctx: {} as Fake['ctx'], timers: [] };
  class LatLng {
    lat: number;
    lng: number;
    constructor(lat: number, lng: number) {
      this.lat = lat;
      this.lng = lng;
    }
    getLat() {
      return this.lat;
    }
    getLng() {
      return this.lng;
    }
  }
  const map = {
    level: 7,
    getLevel: () => map.level,
    setLevel: (l: number) => {
      map.level = l;
      f.calls.push(`setLevel ${l}`);
    },
    setCenter: () => f.calls.push('setCenter'),
    setBounds: (_b: unknown, t: number, r: number, b: number, l: number) => {
      map.level = 2;
      f.calls.push(`setBounds ${t},${r},${b},${l}`);
    },
    relayout: () => f.calls.push('relayout'),
    setZoomable: (v: boolean) => f.calls.push(`setZoomable ${v}`),
    getProjection: () => ({ containerPointFromCoords: (p: LatLng) => ({ x: p.lng * 10, y: p.lat * 10 }) }),
  };
  const kakao = {
    maps: {
      load: (cb: () => void) => {
        if (opts.holdLoad) f.loadCb = cb;
        else cb();
      },
      LatLng,
      LatLngBounds: class {
        extend() {}
      },
      Map: class {
        constructor() {
          return map;
        }
      },
      CustomOverlay: class {
        o: { opts: Record<string, unknown>; map: unknown; pos: unknown };
        constructor(opts: Record<string, unknown>) {
          this.o = { opts, map: null, pos: opts.position };
          f.overlays.push(this.o);
        }
        setMap(m: unknown) {
          this.o.map = m;
        }
        setPosition(p: unknown) {
          this.o.pos = p;
        }
      },
      Polyline: class {
        constructor(opts: Record<string, unknown>) {
          f.lines.push(opts);
        }
        setMap() {}
      },
      Circle: class {
        setMap() {}
        setPosition() {}
        setRadius() {}
      },
      event: {
        addListener: (_t: unknown, type: string, fn: (e?: unknown) => void) => {
          (f.listeners[type] ??= []).push(fn);
        },
      },
    },
  };
  const el = {
    offsetWidth: 300,
    offsetHeight: 200,
    addEventListener() {},
  };
  const makeDiv = () => {
    const d: Record<string, unknown> & { attrs: Record<string, string>; style: Record<string, string>; handlers: Record<string, (e: unknown) => void> } = {
      attrs: {},
      style: {},
      handlers: {},
      setAttribute(k: string, v: string) {
        d.attrs[k] = v;
      },
      addEventListener(t: string, fn: (e: unknown) => void) {
        d.handlers[t] = fn;
      },
    };
    return d;
  };
  const ctx = f.ctx;
  Object.assign(ctx, {
    ReactNativeWebView: { postMessage: (s: string) => f.sent.push(JSON.parse(s)) },
    document: { getElementById: () => el, createElement: makeDiv, visibilityState: 'visible' },
    setTimeout: (fn: () => void) => {
      f.timers.push(fn);
      return f.timers.length;
    },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener() {},
    JSON,
  });
  ctx.window = ctx;
  if (withKakao) ctx.kakao = kakao;
  const html = buildKakaoHtml({ ...PAGE, appKey: 'k' });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  vm.createContext(ctx);
  for (const s of scripts) vm.runInContext(s, ctx);
  return f;
}

test('앱 페이지: 지도가 뜨기 전 메시지는 쌓았다가 ready 뒤 처리하고, view·tap·press를 보낸다', () => {
  const f = runPage(true);
  f.ctx.__ytIn?.({ t: 'markers', coords: [[35, 129], [36, 128]] });
  f.ctx.__ytIn?.({ t: 'lines', lines: [{ coords: [[35, 129], [36, 128]], color: 'C1', dashed: true, weight: 4 }] });
  assert.deepEqual(f.sent, [], 'SDK 전에는 아무것도 보내지 않는다');
  f.ctx.__ytScriptLoaded?.();
  assert.deepEqual(f.sent[0], { t: 'ready' });
  assert.deepEqual(f.sent[1], { t: 'view', level: 7, points: [[1290, 350], [1280, 360]] });
  assert.equal(f.lines[0].strokeStyle, 'shortdash');
  assert.equal(f.lines[0].strokeColor, 'C1');

  const item = { key: 'm:a', sig: 's1', z: 3, html: '<svg></svg>', size: 34, name: '1번 a', press: true, at: [35, 129] };
  f.ctx.__ytIn?.({ t: 'items', items: [item, { ...item, key: 'd:p', press: false, name: undefined }] });
  assert.equal(f.overlays.length, 2);
  assert.equal(f.overlays[0].opts.clickable, true);
  assert.equal(f.overlays[1].opts.clickable, false);
  const node = f.overlays[0].opts.content as { attrs: Record<string, string>; handlers: Record<string, (e: unknown) => void> };
  assert.equal(node.attrs.role, 'button');
  assert.equal(node.attrs['aria-label'], '1번 a');
  assert.equal((f.overlays[1].opts.content as { attrs: Record<string, string> }).attrs['aria-hidden'], 'true');
  node.handlers.click({ stopPropagation() {} });
  assert.deepEqual(f.sent.at(-1), { t: 'tap', key: 'm:a' });

  // 같은 서명이면 노드를 다시 만들지 않고 자리만 옮기고, 빠진 핀은 지운다
  f.ctx.__ytIn?.({ t: 'items', items: [{ ...item, at: [35.5, 129.5] }] });
  assert.equal(f.overlays.length, 2);
  assert.equal(f.overlays[1].map, null);

  // 화면 맞춤: 여백 네 방향, 배율 한도보다 당기지 않는다
  f.ctx.__ytIn?.({ t: 'fit', coords: [[35, 129], [36, 128]], pad: { top: 96, right: 40, bottom: 48, left: 40 }, maxLevel: 4 });
  assert.ok(f.calls.includes('setBounds 96,40,48,40'));
  assert.equal(f.calls.at(-1), 'setLevel 4');
  assert.ok(f.calls.includes('relayout'));

  // 지도 클릭은 지연 뒤에 보내고 더블클릭이면 취소한다(가짜 타이머라 직접 돌린다)
  f.listeners.click[0]({ latLng: { getLat: () => 35.1, getLng: () => 129.1 } });
  f.timers.at(-1)?.();
  assert.deepEqual(f.sent.at(-1), { t: 'press', lat: 35.1, lng: 129.1 });
  f.listeners.dragstart[0]();
  assert.deepEqual(f.sent.at(-1), { t: 'moved' });
});

test('앱 페이지: SDK가 없으면 script, 지도 코드가 시한 안에 안 오면 auth로 알린다(한 번만)', () => {
  const noSdk = runPage(false);
  noSdk.ctx.__ytScriptLoaded?.();
  assert.deepEqual(noSdk.sent, [{ t: 'fail', reason: 'script' }]);
  const err = runPage(true);
  err.ctx.__ytScriptError?.();
  assert.deepEqual(err.sent, [{ t: 'fail', reason: 'script' }]);
  const slow = runPage(true, { holdLoad: true });
  assert.equal(slow.timers.length, 0, '로드 시한은 SDK 스크립트를 받은 뒤에 건다(스크립트 받는 시간은 세지 않는다)');
  slow.ctx.__ytScriptLoaded?.();
  assert.equal(slow.timers.length, 1);
  slow.timers[0](); // 로드 시한
  slow.loadCb?.();
  assert.deepEqual(slow.sent, [{ t: 'fail', reason: 'auth' }], '실패 뒤에는 지도를 만들지 않는다');
});

test('앱 페이지: 화면이 가려진 동안에는 로드 시한을 미루고, 다시 보이면 센다', () => {
  const f = runPage(true, { holdLoad: true });
  f.ctx.__ytScriptLoaded?.();
  const doc = f.ctx.document as { visibilityState: string };
  doc.visibilityState = 'hidden';
  f.timers[0]();
  assert.deepEqual(f.sent, [], '가려진 동안에는 auth로 보지 않는다');
  assert.equal(f.timers.length, 2, '시한을 다시 건다');
  doc.visibilityState = 'visible';
  f.timers[1]();
  assert.deepEqual(f.sent, [{ t: 'fail', reason: 'auth' }]);
});

test('앱 WebView 이동: 다리 페이지와 하위 프레임만 두고, 바깥 링크는 바깥 브라우저로, 그 밖은 막는다', () => {
  assert.equal(KAKAO_WEBVIEW_BASE_URL, 'https://localhost');
  assert.deepEqual(KAKAO_WEBVIEW_ORIGINS, ['https://localhost*', 'about:*']);
  assert.equal(kakaoNavAction('about:blank'), 'allow');
  assert.equal(kakaoNavAction('https://localhost'), 'allow');
  assert.equal(kakaoNavAction('https://localhost/'), 'allow');
  assert.equal(kakaoNavAction('https://map.kakao.com/', true), 'open', '카카오 로고 링크는 지도 칸을 바꾸지 않는다');
  assert.equal(kakaoNavAction('http://example.com/x'), 'open');
  assert.equal(kakaoNavAction('https://localhost.evil.example/'), 'open', 'localhost로 시작하는 다른 호스트는 다리 페이지가 아니다');
  assert.equal(kakaoNavAction('intent://x#Intent;end'), 'block');
  assert.equal(kakaoNavAction('javascript:alert(1)'), 'block');
  assert.equal(kakaoNavAction('https://t1.daumcdn.net/x', false), 'allow', '하위 프레임은 그대로 둔다');
  // 메시지 출처
  assert.equal(isKakaoBridgeUrl(undefined), true);
  assert.equal(isKakaoBridgeUrl('about:blank'), true);
  assert.equal(isKakaoBridgeUrl('https://localhost/'), true);
  assert.equal(isKakaoBridgeUrl('https://map.kakao.com/'), false);
  assert.equal(isKakaoBridgeUrl('http://localhost'), false);
});

test('Ctrl·Cmd+휠 확대: 잘게 오는 트랙패드 핀치는 쌓아서 한 단계씩, 0은 무시, 방향이 바뀌면 처음부터', () => {
  // 리뷰 재현: deltaY -2가 40번 와도 레벨 7에서 1까지 떨어지지 않는다
  let acc = 0;
  let level = 7;
  for (let i = 0; i < 40; i++) {
    const r = wheelZoomStep(acc, -2);
    acc = r.acc;
    level += r.step;
  }
  assert.equal(level, 7, '80픽셀은 한 단계에 못 미친다');
  for (let i = 0; i < 10; i++) {
    const r = wheelZoomStep(acc, -2);
    acc = r.acc;
    level += r.step;
  }
  assert.equal(level, 6, '100픽셀이 쌓이면 한 단계');
  assert.equal(acc, 0);
  assert.deepEqual(wheelZoomStep(0, 0), { acc: 0, step: 0 });
  assert.deepEqual(wheelZoomStep(40, 0), { acc: 40, step: 0 });
  assert.deepEqual(wheelZoomStep(0, 100), { acc: 0, step: 1 }, '마우스 휠 한 칸은 바로 한 단계');
  assert.deepEqual(wheelZoomStep(0, -3, 1), { acc: 0, step: -1 }, '줄 단위 휠은 픽셀로 바꾼다');
  assert.deepEqual(wheelZoomStep(90, -20), { acc: -20, step: 0 }, '방향이 바뀌면 쌓인 양을 버린다');
  assert.equal(KAKAO_WHEEL_STEP_PX, 100);
});

/* ---------- 어댑터 소스 규칙 ---------- */

const read = (f: string) => readFileSync(f, 'utf8');

test('카카오 어댑터: pointerEvents는 StyleSheet로만, 세 가지 실패를 알리고, 우리 묶음 규칙과 여백 네 방향을 쓴다', () => {
  const webSrc = read('src/components/map/KakaoMapView.web.tsx');
  const appSrc = read('src/components/map/KakaoMapView.tsx');
  for (const [name, src] of [
    ['web', webSrc],
    ['app', appSrc],
  ] as const) {
    assert.doesNotMatch(src, /style=\{\{[^}]*pointerEvents/, `${name}: 인라인 pointerEvents는 웹에서 버려진다`);
    assert.match(src, /<MapChildren>/, name);
    assert.match(src, /<ClusterListSheet/, name);
    assert.match(src, /FitAllButton/, name);
    assert.doesNotMatch(src, /MarkerClusterer|clusterer/, `${name}: 카카오 클러스터러 대신 core/map/layout 규칙`);
    assert.match(src, /buildOverlayItems/, name);
    assert.match(src, /kakaoLevel\(FIT_MAX_ZOOM\)|FIT_MAX_ZOOM\)/, name);
  }
  assert.match(webSrc, /kakaoScriptUrl\(KAKAO_MAP_JS_KEY\)/);
  assert.match(webSrc, /new LoadError\('auth'\)/);
  assert.match(webSrc, /new LoadError\('script'\)/);
  assert.match(webSrc, /fail\('tiles'\)/);
  assert.match(webSrc, /map\.setBounds\(b, pad\.top, pad\.right, pad\.bottom, pad\.left\)/);
  assert.match(webSrc, /map\.relayout\(\)/);
  assert.match(webSrc, /new ResizeObserver/);
  assert.match(webSrc, /document\.visibilityState === 'visible'/);
  // 그냥 휠 확대는 화면 가득한 지도(flat)와 시트 안 지도(wheelZoom)만. 스크롤 화면 안의 지도는 Ctrl·Cmd+휠
  assert.match(webSrc, /const greedy = flat \|\| !!p\.wheelZoom;/);
  assert.match(webSrc, /scrollwheel: !p\.compact && greedy/);
  assert.match(webSrc, /e\.ctrlKey && !e\.metaKey/);
  assert.match(webSrc, /KAKAO_CLICK_DELAY_MS/);
  assert.doesNotMatch(webSrc, /replaceChildren/);
  assert.match(webSrc, /aria-hidden/);
  assert.match(appSrc, /baseUrl: KAKAO_WEBVIEW_BASE_URL/);
  assert.doesNotMatch(appSrc, /originWhitelist=\{\['\*'\]\}/, '모든 출처를 허용하지 않는다');
  assert.match(appSrc, /originWhitelist=\{KAKAO_WEBVIEW_ORIGINS\}/);
  assert.match(appSrc, /onShouldStartLoadWithRequest=\{onNav\}/);
  assert.match(appSrc, /onOpenWindow=/);
  assert.match(appSrc, /Linking\.openURL/);
  assert.doesNotMatch(appSrc, /setSupportMultipleWindows=\{false\}/, 'false면 새 창 링크가 지도 칸 안에서 열린다');
  assert.match(appSrc, /isKakaoBridgeUrl\(e\.nativeEvent\.url\)/, '다리 페이지가 아닌 문서의 메시지는 버린다');
  // 다시 뜬 페이지 복구: ready마다 마커 좌표부터 다시 보내고, 프로세스가 죽으면 다시 읽거나 새로 만든다
  assert.match(appSrc, /forKey: ''/);
  assert.match(appSrc, /setReady\(\(n\) => n \+ 1\)/);
  assert.match(appSrc, /onContentProcessDidTerminate=\{\(\) => web\.current\?\.reload\(\)\}/);
  assert.match(appSrc, /onRenderProcessGone=\{onRenderGone\}/);
  assert.match(appSrc, /key=\{gen\}/);
  // 웹: 휠은 쌓아서, 키보드는 직접 처리(SDK 단축키 대신)
  assert.match(webSrc, /wheelZoomStep\(wheelAcc, e\.deltaY, e\.deltaMode\)/);
  assert.match(webSrc, /map\.panBy\(k\.pan\[0\], k\.pan\[1\]\)/);
  assert.match(webSrc, /el\.tabIndex = 0/);
  assert.match(appSrc, /onFail\('script'\)/);
  assert.match(appSrc, /parseKakaoOut/);
  assert.match(appSrc, /bridgeScript/);
});

test('MapCanvas: 카카오가 기본이고, 실패하면 이름을 넣은 안내 한 번 뒤 기본 지도로 돌아온다(타일은 그 지도만)', () => {
  const src = read('src/components/map/MapCanvas.tsx');
  assert.match(src, /MAP_ENGINE === 'kakao' && KAKAO_VIEW_READY \? 'kakao'/);
  assert.match(src, /<KakaoMapView \{\.\.\.props\} onFail=\{onFail\} \/>/);
  assert.match(src, /<GoogleMapView \{\.\.\.props\} onFail=\{onFail\} \/>/);
  assert.match(src, /kakao: '카카오 지도'/);
  assert.match(src, /if \(reason !== 'tiles'\) sdkDown = true/);
  const engine = read('src/components/map/engine.ts');
  assert.match(engine, /kakaoKey: KAKAO_MAP_JS_KEY/);
  const config = read('src/config.ts');
  assert.match(config, /process\.env\.EXPO_PUBLIC_KAKAO_MAP_JS_KEY/);
  assert.match(read('.env.example'), /^EXPO_PUBLIC_KAKAO_MAP_JS_KEY=$/m);
});
