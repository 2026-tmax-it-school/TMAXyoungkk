import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import { initialWatchProfile, nextWatchProfile, throttleSample, type ThrottleState, type WatchProfileState } from '../src/core/live/throttle';
import { kakaoLevel } from '../src/core/map/engine';
import {
  acceptFix,
  LOCATE_MIN_MOVE_M,
  LOCATE_RECENTER_MS,
  LOCATE_ZOOM,
  locateFailText,
  locateLabel,
  locateNext,
  moveM,
  shouldRecenter,
  type LocateEvent,
  type LocateMode,
} from '../src/core/map/locate';
import { bridgeScript, buildKakaoHtml } from '../src/components/map/kakaoHtml';
import { read, stripComments } from './setup/scan';

/**
 * 지도 '내 위치' 버튼(FR-801, 2026-10-10 'GPS 기능도 추가하자').
 * 순수 상태 규칙과 거리·간격 거르기, 위치 공급 훅의 소스 규칙(누를 때만 감시, 끄는 때, live 우선),
 * 버튼 자리(미리보기 제외), 엔진별 옮기기 연결, 앱 카카오 페이지의 center 다리.
 */

const A = { latitude: 35.8347, longitude: 129.2186 };
/** 위도 0.00001도는 약 1.1m */
const north = (m: number) => ({ latitude: A.latitude + m / 111_320, longitude: A.longitude });

test('상태: off → 누름 → locating → 첫 위치 → centered → 누름 → follow → 누름 → off', () => {
  let m: LocateMode = 'off';
  m = locateNext(m, { type: 'tap' });
  assert.equal(m, 'locating');
  m = locateNext(m, { type: 'fix' });
  assert.equal(m, 'centered');
  m = locateNext(m, { type: 'fix' });
  assert.equal(m, 'centered', '위치가 더 와도 centered 그대로');
  m = locateNext(m, { type: 'tap' });
  assert.equal(m, 'follow');
  m = locateNext(m, { type: 'fix' });
  assert.equal(m, 'follow');
  m = locateNext(m, { type: 'tap' });
  assert.equal(m, 'off');
});

test('상태: 손으로 움직이면 따라가기만 풀리고, 실패는 찾는 중에만 off, stop은 어디서든 off', () => {
  const all: LocateMode[] = ['off', 'locating', 'centered', 'follow'];
  const ev = (e: LocateEvent) => all.map((m) => locateNext(m, e));
  assert.deepEqual(ev({ type: 'userMove' }), ['off', 'locating', 'centered', 'centered']);
  assert.deepEqual(ev({ type: 'fail', reason: 'denied' }), ['off', 'off', 'centered', 'follow']);
  assert.deepEqual(ev({ type: 'fail', reason: 'timeout' }), ['off', 'off', 'centered', 'follow']);
  assert.deepEqual(ev({ type: 'stop' }), ['off', 'off', 'off', 'off']);
  assert.deepEqual(ev({ type: 'fix' }), ['off', 'centered', 'centered', 'follow'], 'off에서 늦게 온 위치는 무시');
  assert.equal(locateNext('locating', { type: 'tap' }), 'off', '찾는 중에 누르면 취소');
});

test('읽기 이름은 누르면 무엇이 되는지, 실패 안내는 한국어이고 거부면 켜는 방법을 말한다', () => {
  assert.equal(locateLabel('off'), '내 위치 보기');
  assert.equal(locateLabel('centered'), '내 위치 따라가기');
  assert.equal(locateLabel('follow'), '따라가기 끄기');
  assert.match(locateLabel('locating'), /찾는 중/);
  assert.match(locateFailText('denied', true), /허용/);
  assert.match(locateFailText('denied', true), /사이트 설정/);
  assert.match(locateFailText('denied', false), /설정/);
  assert.match(locateFailText('unavailable', true), /https|localhost/);
  assert.match(locateFailText('timeout', false), /다시/);
  for (const r of ['denied', 'unavailable', 'timeout'] as const) {
    for (const w of [true, false]) assert.doesNotMatch(locateFailText(r, w), /[←-⇿>]/);
  }
});

test('거르기: 5m 안쪽 흔들림은 버리고, 정확도가 크게 바뀌면 받는다', () => {
  assert.ok(Math.abs(moveM(A, north(10)) - 10) < 0.2);
  const p = { coord: A, accuracyM: 20 };
  assert.equal(acceptFix(undefined, p), true, '처음은 받는다');
  assert.equal(acceptFix(p, { coord: north(3), accuracyM: 20 }), false);
  assert.equal(acceptFix(p, { coord: north(LOCATE_MIN_MOVE_M + 1), accuracyM: 20 }), true);
  assert.equal(acceptFix(p, { coord: north(1), accuracyM: 60 }), true, '정확도 20m에서 60m');
  assert.equal(acceptFix(p, { coord: north(1), accuracyM: 25 }), false);
  assert.equal(acceptFix(p, { coord: north(1), accuracyM: null }), true, '정확도를 모르게 됨');
});

test('따라가기 다시 옮기기: 1초에 한 번까지, 5m 넘게 움직였을 때만', () => {
  const last = { coord: A, at: 10_000 };
  assert.equal(shouldRecenter(undefined, A, 0), true);
  assert.equal(shouldRecenter(last, north(20), 10_000 + LOCATE_RECENTER_MS - 1), false, '1초 안');
  assert.equal(shouldRecenter(last, north(20), 10_000 + LOCATE_RECENTER_MS), true);
  assert.equal(shouldRecenter(last, north(3), 20_000), false, '5m 안');
  assert.equal(shouldRecenter(last, north(20), 5_000), true, '시계가 뒤로 가면 다시 센다');
  assert.equal(kakaoLevel(LOCATE_ZOOM), 3, '거리 단위 배율(카카오 레벨 3)');
});

/* ---------- 소스 규칙 ---------- */

const hook = stripComments(read('src/components/map/useMyLocation.ts'));
const canvas = stripComments(read('src/components/map/MapCanvas.tsx'));
const parts = stripComments(read('src/components/map/parts.tsx'));

/** 함수 본문(이름부터 다음 'const ... = useCallback' 또는 'useEffect' 전까지) */
function body(src: string, name: string): string {
  const i = src.indexOf(`const ${name} = useCallback(`);
  assert.ok(i >= 0, `${name} 없음`);
  const rest = src.slice(i + 1);
  const end = rest.search(/\n {2}(const \w+ = useCallback\(|useEffect\(|const \w+ = use|return \{)/);
  return rest.slice(0, end < 0 ? undefined : end);
}

test('훅: GPS 감시(watch)는 startWatch 한 곳에서만 켜고, startWatch는 누름(onTap)에서만 부른다', () => {
  const watches = [...hook.matchAll(/\.watch\(/g)];
  assert.equal(watches.length, 1, 'watch 호출은 한 곳');
  assert.match(body(hook, 'startWatch'), /provider\.watch\(/);
  const calls = [...hook.matchAll(/startWatch\(\)/g)];
  assert.equal(calls.length, 1, 'startWatch를 부르는 곳은 하나');
  assert.match(body(hook, 'onTap'), /void startWatch\(\)/);
  // 열릴 때 켜지 않는다: 어떤 useEffect 안에도 startWatch·watch·permission·request가 없다
  const effects = [...hook.matchAll(/useEffect\(([\s\S]*?)\n {2}\}, \[/g)];
  assert.ok(effects.length >= 3, '효과를 찾았다');
  for (const m of effects) {
    assert.doesNotMatch(m[1], /startWatch\(|\.watch\(|\.permission\(|\.request\(/, '효과 안에서 위치를 켜지 않는다');
  }
  // 권한을 묻고, 거부·시한·못 씀을 나눠 알린다
  assert.match(hook, /provider\.permission\(\)/);
  assert.match(hook, /provider\.request\(\)/);
  assert.match(hook, /fail\('denied'\)/);
  assert.match(hook, /fail\('timeout'\)/);
  assert.match(hook, /fail\('unavailable'\)/);
  assert.match(hook, /showToast\(locateFailText\(/);
  assert.match(hook, /isSecureContext/);
});

test('훅: 내려갈 때·화면이 가려질 때·앱이 뒤로 갈 때 감시를 끈다', () => {
  assert.match(hook, /useEffect\(\(\) => \(\) => stopWatch\(\), \[stopWatch\]\)/, 'unmount');
  assert.match(hook, /useIsFocused\(\)/);
  assert.match(hook, /if \(!focused\) turnOff\(\)/, 'blur');
  assert.match(hook, /AppState\.addEventListener\('change'/);
  assert.match(hook, /s === 'background'\) turnOff\(\)/, 'background');
  assert.match(body(hook, 'turnOff'), /stopWatch\(\)/);
  assert.match(body(hook, 'stopWatch'), /stop\?\.\(\)/);
  assert.match(body(hook, 'stopWatch'), /clearTimeout\(timerRef\.current\)/);
});

test('훅: 화면이 준 live 위치(시뮬레이터 포함)가 있으면 GPS 대신 그것을 쓰고, 위치를 어디에도 보내지 않는다', () => {
  const tap = body(hook, 'onTap');
  assert.match(tap, /if \(l\) onFix\(l\);\s*else void startWatch\(\);/);
  assert.match(hook, /user: live \?\? /, '지도에 그릴 위치도 live가 먼저');
  assert.match(hook, /sourceRef\.current === 'gps'\) \{\s*stopWatch\(\)/, 'live가 생기면 GPS를 끈다');
  assert.doesNotMatch(hook, /fetch\(|\.sync\b|upload|dispatch\(tripId|kv\.|AsyncStorage|useLive|useTrips/);
  assert.match(body(hook, 'onFix'), /acceptFix\(/);
  assert.match(body(hook, 'onFix'), /shouldRecenter\(/);
});

test('MapCanvas: locate일 때만, 미리보기(compact)가 아닐 때만 버튼과 훅을 쓴다. live user를 넘기고 내 위치를 user로 합친다', () => {
  assert.match(canvas, /if \(props\.locate && !props\.compact\) return <LocatingMap/);
  assert.match(canvas, /useMyLocation\(props\.user/);
  assert.match(canvas, /user: loc\.user/);
  assert.match(canvas, /center: loc\.center/);
  assert.match(canvas, /holdFit: loc\.mode === 'follow'/);
  assert.match(canvas, /<LocateButton mode=\{loc\.mode\}/);
  // 훅은 LocatingMap 안에서만(다른 지도는 내비게이터 밖에서도 그려진다)
  assert.equal([...canvas.matchAll(/useMyLocation\(/g)].length, 1);
  // 버튼: 오른쪽 아래, 읽기 이름은 상태별, pointerEvents 인라인 없음
  assert.match(parts, /locateWrap: \{ position: 'absolute', right: SP\.gutter/);
  assert.match(parts, /accessibilityLabel=\{locateLabel\(mode\)\}/);
  assert.match(parts, /StyleSheet\.create\(\{\s*overlay: \{[^}]*pointerEvents: 'box-none'/);
});

test('화면: 11 지도 탭과 27 길찾기에 버튼을 켜고, 미리보기 지도에는 켜지 않는다', () => {
  for (const f of ['src/screens/MapScreen.tsx', 'src/screens/DirectionsScreen.tsx']) {
    assert.match(stripComments(read(f)), /<MapCanvas[\s\S]*?\n\s+locate\n/, f);
  }
  for (const f of ['src/screens/SpotDetailScreen.tsx', 'src/features/candidates/components/ManualAdd.tsx', 'src/screens/RecordMapScreen.tsx']) {
    assert.doesNotMatch(stripComments(read(f)), /^\s+locate(=\{[^}]*\})?\s*$/m, f);
  }
  // 길찾기: 지도 버튼은 출발·도착을 바꾸지 않는다(끝점은 pickMe만 바꾼다)
  const dir = stripComments(read('src/screens/DirectionsScreen.tsx'));
  assert.doesNotMatch(dir, /onUserMove|useMyLocation/);
});

test('엔진: 카카오 웹·앱, 구글 웹·앱, 기본 지도가 center 요청으로 옮기고, 손으로 움직이면 onUserMove, 따라가기 중엔 다시 맞추지 않는다', () => {
  const kweb = stripComments(read('src/components/map/KakaoMapView.web.tsx'));
  assert.match(kweb, /const centerSeq = props\.center\?\.seq/);
  assert.match(kweb, /map\.setLevel\(level\)/);
  assert.match(kweb, /map\.panTo\(at\)/);
  assert.match(kweb, /if \(ready && !latest\.current\.holdFit\) fit\(\)/);
  assert.match(kweb, /const onDrag = \(\) => userMoved\(\)/);

  const kapp = stripComments(read('src/components/map/KakaoMapView.tsx'));
  assert.match(kapp, /send\(\{ t: 'center', at: toLL\(c\.coord\)/);
  assert.match(kapp, /case 'moved':[\s\S]*?onUserMove\?\.\(\)/);
  assert.match(kapp, /!latest\.current\.holdFit\) fit\(\)/);

  const gweb = stripComments(read('src/components/map/GoogleMapView.web.tsx'));
  assert.match(gweb, /map\.panTo\(toG\(c\.coord\)\)/);
  assert.match(gweb, /map\.setZoom\(c\.zoom\)/);
  assert.match(gweb, /map\.addListener\('dragstart', \(\) => userMoved\(\)\)/);
  assert.match(gweb, /if \(ready && !latest\.current\.holdFit\) fit\(\)/);

  const gapp = stripComments(read('src/components/map/GoogleMapView.tsx'));
  assert.match(gapp, /map\.animateCamera\(\{ center: c\.coord \}/);
  assert.match(gapp, /onPanDrag=\{\(\) => \{[\s\S]*?onUserMove\?\.\(\)/);
  assert.match(gapp, /!props\.holdFit\) fit\(\)/);

  assert.match(canvas, /if \(c\) setFocus\(\[c\.coord\]\)/, '기본 지도는 그 점 둘레로 당긴다');
  for (const src of [kweb, kapp, gweb, gapp, canvas]) assert.match(src, /onUserMove\?\.\(\)/);
});

test('앱 카카오 페이지: center는 레벨이 있으면 당겨서 setCenter, 없으면 panTo하고 view를 보낸다', () => {
  const sent: { t: string }[] = [];
  const calls: string[] = [];
  const map = {
    level: 7,
    getLevel: () => map.level,
    setLevel: (l: number) => {
      map.level = l;
      calls.push(`setLevel ${l}`);
    },
    setCenter: () => calls.push('setCenter'),
    panTo: () => calls.push('panTo'),
    relayout: () => {},
    getProjection: () => ({ containerPointFromCoords: () => ({ x: 1, y: 1 }) }),
  };
  const ctx: Record<string, unknown> & { __ytIn?: (m: unknown) => void; __ytScriptLoaded?: () => void } = {};
  Object.assign(ctx, {
    ReactNativeWebView: { postMessage: (s: string) => sent.push(JSON.parse(s)) },
    document: { getElementById: () => ({ offsetWidth: 1, offsetHeight: 1, addEventListener() {} }), visibilityState: 'visible' },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener() {},
    JSON,
    kakao: {
      maps: {
        load: (cb: () => void) => cb(),
        LatLng: class {},
        Map: class {
          constructor() {
            return map;
          }
        },
        event: { addListener() {} },
      },
    },
  });
  ctx.window = ctx;
  const html = buildKakaoHtml({ appKey: 'k', bg: '#000', compact: false, center: [35, 129], level: 7, loadTimeoutMs: 1, tileTimeoutMs: 1, clickDelayMs: 1 });
  vm.createContext(ctx);
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(m[1], ctx);
  ctx.__ytScriptLoaded?.();
  const run = (msg: Parameters<typeof bridgeScript>[0]) => vm.runInContext(bridgeScript(msg), ctx);
  run({ t: 'center', at: [35.1, 129.1], level: 3 });
  assert.deepEqual(calls, ['setLevel 3', 'setCenter']);
  assert.equal(sent.at(-1)?.t, 'view');
  calls.length = 0;
  run({ t: 'center', at: [35.1, 129.1], level: 5 });
  assert.deepEqual(calls, ['setCenter'], '이미 더 가까우면 멀어지지 않는다');
  calls.length = 0;
  run({ t: 'center', at: [35.2, 129.2] });
  assert.deepEqual(calls, ['panTo']);
});

test('훅: 껐다 다시 켜면 새 위치가 오기 전에는 지난 이동 요청(옛 자리)을 넘기지 않는다', () => {
  assert.match(body(hook, 'turnOff'), /setCenter\(undefined\)/, '끌 때 지난 요청을 지운다');
  assert.match(body(hook, 'fail'), /setCenter\(undefined\)/, '실패할 때도 지운다');
  // 찾는 중(locating)에는 요청을 넘기지 않는다. 첫 위치가 오면 새 seq로 넘긴다
  assert.match(hook, /center: mode === 'centered' \|\| mode === 'follow' \? center : undefined/);
});

test('위치 감시: 내 위치는 정지용(20m 갱신)으로 바꾸지 않는다. 1초에 1.4m씩 걸어도 active 그대로', () => {
  const walk = (adaptive: boolean) => {
    let th: ThrottleState = {};
    let pf: WatchProfileState = initialWatchProfile;
    let changed = 0;
    for (let i = 0; i < 60; i += 1) {
      const r = throttleSample(th, { t: i * 1000, coord: north(i * 1.4), accuracyM: 5 }, { intervalMs: 1000 });
      th = r.state;
      const np = nextWatchProfile(pf, r.decision, adaptive);
      pf = np.state;
      if (np.changed) changed += 1;
    }
    return { profile: pf.profile, changed };
  };
  assert.deepEqual(walk(false), { profile: 'active', changed: 0 });
  // 기록용(기본)은 그대로 정지 판정으로 바뀐다(배터리 규칙은 그대로 둔다)
  assert.notEqual(walk(true).changed, 0);
  const device = stripComments(read('src/services/location/device.ts'));
  assert.match(device, /nextWatchProfile\(profile, r\.decision, opts\.adaptive !== false\)/);
  assert.match(hook, /provider\.watch\([\s\S]*?\{ intervalMs: 1000, adaptive: false \}\)/);
});

test('맞춤: 내 위치 버튼의 점(locateUser)은 화면 맞춤에 넣지 않는다(빈 지도에서 켜고 끌 때 경주로 뛰지 않게)', () => {
  assert.match(canvas, /locateUser: !props\.user && !!loc\.user/);
  for (const f of ['KakaoMapView.web.tsx', 'KakaoMapView.tsx', 'GoogleMapView.web.tsx', 'GoogleMapView.tsx']) {
    const src = stripComments(read(`src/components/map/${f}`));
    assert.match(src, /const hasUser = !!props\.user && !props\.locateUser/, f);
    assert.match(src, /user: (latest\.current|props)\.locateUser \? undefined : (latest\.current|props)\.user \}\)/, f);
  }
});
