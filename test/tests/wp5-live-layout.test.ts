import assert from 'node:assert/strict';
import { test } from 'node:test';

import { read, stripComments } from './setup/scan';

/**
 * 19 여행 진행 배치(UX 점검 B8, 2026-10-12).
 * 진행 중 주 행동(도착 처리, 구간 안내)은 엄지가 닿는 Foot에 있고, 끝내기는 확인 시트를 한 번 거친다.
 * 기기 위치로 시작할 때는 설정을 먼저 켜고 그다음 시작한다(끈 채로 시작하면 store/live invalidReason이 진행을 바로 끝낸다).
 * 시작 전에는 시뮬레이터 조작 카드 전체를 그리지 않고 접힌 프리셋 줄만 둔다. 이름은 '구간 안내'(13)로 맞춘다.
 * 소스 규칙으로 고정한다.
 */

const live = stripComments(read('src/screens/LiveTripScreen.tsx'));
const sim = stripComments(read('src/features/live/components/SimControls.tsx'));
const free = stripComments(read('src/features/live/components/FreeTimeCard.tsx'));
const nowCard = stripComments(read('src/features/live/components/LiveNowCard.tsx'));
const banner = stripComments(read('src/features/live/components/SimBanner.tsx'));

/** 처음 나오는 open 태그부터 그 짝 close 태그까지(중첩 없음 가정) */
function block(src: string, open: string, close: string, from = 0): string {
  const a = src.indexOf(open, from);
  assert.ok(a >= 0, `${open} 없음`);
  const b = src.indexOf(close, a);
  assert.ok(b > a, `${close} 없음`);
  return src.slice(a, b + close.length);
}

/** confirmLabel이 label인 ConfirmSheet 하나(여는 태그부터 '/>'까지) */
function confirmSheet(src: string, label: string): string {
  const at = src.indexOf(`confirmLabel="${label}"`);
  assert.ok(at >= 0, `ConfirmSheet '${label}' 없음`);
  const a = src.lastIndexOf('<ConfirmSheet', at);
  const b = src.indexOf('/>', at);
  assert.ok(a >= 0 && b > at);
  return src.slice(a, b + 2);
}

test("19 진행 중: '도착 처리'와 '구간 안내'는 Foot 안에 있고, 도착 처리는 수동·정확도 모름이면 primary다", () => {
  const foot = block(live, '<Foot>', '</Foot>');
  assert.match(foot, /title="도착 처리"/);
  assert.match(foot, /title="구간 안내"/);
  assert.match(foot, /variant=\{manualArrive \? 'primary' : 'quiet'\}/);
  assert.match(live, /const manualArrive = live\.mode === 'manual' \|\| live\.accuracyUnknown;/);
  // 도착 처리는 Foot 밖 본문에 다시 두지 않는다
  assert.equal(live.split('title="도착 처리"').length - 1, 1);
  // 도착 처리가 붙는 스팟(timing.spotId)의 이름을 Foot 맨 위 한 줄로 늘 보인다(도착해 머무는 중이면 지금 카드 제목은 머무는 스팟이다)
  assert.match(foot, /^<Foot>\s*<Txt v="mtTight" numberOfLines=\{1\}>\{`다음 · \$\{timing\.name\}`\}<\/Txt>\s*<Row/);
  assert.match(foot, /onPress=\{\(\) => L\.markArrived\(timing\.spotId\)\}/);
  // 오늘 일정을 다 마치면 Foot은 '여행일지 보기' 하나다
  assert.match(live, /running && timing === null \? \(\s*<Foot>\s*<Btn title="여행일지 보기"/);
});

test("19 진행 중: '길찾기' 버튼 라벨이 없고 13 이름 '구간 안내'를 쓴다", () => {
  assert.doesNotMatch(live, /title="길찾기"/);
  assert.match(live, /navigation\.navigate\('Navigate', \{ tripId, date, legIndex: nextLeg\.index \}\)/);
});

test('19 끝내기: L.stop()은 ConfirmSheet onConfirm 안에서만 부른다', () => {
  const sheet = confirmSheet(live, '진행 끝내기');
  assert.match(sheet, /title="여행 진행을 끝낼까요\?"/);
  assert.match(sheet, /onConfirm=\{\(\) => \{[\s\S]*?L\.stop\(\);[\s\S]*?\}\}/);
  assert.equal(live.split('L.stop()').length - 1, 1, 'L.stop()을 확인 없이 부르는 곳이 없다');
  assert.match(live, /<Btn title="여행 진행 끝내기" variant="quiet" size="sm" onPress=\{\(\) => setAskStop\(true\)\} \/>/);
});

test('19 시작 전: 기기 위치는 setUseDeviceLocation(true)를 먼저 부르고 그다음 L.start(…, device)를 부른다', () => {
  const on = live.indexOf('setUseDeviceLocation(true)');
  const start = live.indexOf("L.start(tripId, date, 'device')");
  assert.ok(on >= 0, 'setUseDeviceLocation(true) 없음');
  assert.ok(start >= 0, "L.start(…, 'device') 없음");
  assert.ok(on < start, '설정을 켠 다음 시작한다');
  assert.equal(live.split("L.start(tripId, date, 'device')").length - 1, 1, '기기 위치 시작은 한 곳뿐이다');
  // 기기 위치가 꺼져 있으면 확인 시트를 거친다
  const sheet = confirmSheet(live, '기기 위치 켜고 시작');
  assert.match(sheet, /title="기기 위치를 쓸까요\?"/);
  assert.match(sheet, /onConfirm=\{beginDevice\}/);
  assert.match(live, /const pickDevice = \(\) => \(useDevice \? beginDevice\(\) : setAskDevice\(true\)\);/);
});

test('19 시작 전: 진행 방식은 ListRow 세 줄이고, 오늘이 여행 기간 안이면 기기 위치가 맨 위다', () => {
  assert.match(live, /label="기기 위치로 진행"/);
  assert.match(live, /label="수동으로 진행"/);
  assert.match(live, /label="시뮬레이터로 재생"/);
  assert.match(
    live,
    /tripStatus\(trip, now\) === 'ongoing' \? \(\['device', 'manual', 'sim'\] as const\) : \(\['sim', 'device', 'manual'\] as const\)[\s\S]{0,40}\.filter\(\(k\) => demoAllowed \|\| k !== 'sim'\)/,
  );
  // '어떻게 진행할까요'는 지도보다 앞이다
  assert.ok(live.indexOf('어떻게 진행할까요') < live.indexOf('<MapCanvas'));
  // 기기 위치 버튼을 이유 없이 끄지 않는다
  assert.doesNotMatch(live, /disabled=\{!useDevice\}/);
});

test('19 시작 전에는 SimControls 전체를 그리지 않는다(접힌 프리셋 줄만)', () => {
  const uses = live.match(/<SimControls\b[\s\S]*?\/>/g) ?? [];
  assert.equal(uses.length, 2);
  const preStart = uses.filter((u) => /\bpresetsOnly\b/.test(u));
  const full = uses.filter((u) => !/\bpresetsOnly\b/.test(u));
  assert.equal(preStart.length, 1);
  assert.equal(full.length, 1);
  // 전체 조작은 진행 중(시뮬레이터)일 때만
  const at = live.indexOf(full[0]);
  assert.match(live.slice(Math.max(0, at - 120), at), /\{running && hasItems && live\.requested === 'sim' \? \(\s*$/);
  // presetsOnly는 재생·배속·점프 없이 접힌 프리셋 줄이다
  assert.match(sim, /if \(props\.presetsOnly\) return <PresetFold/);
  const fold = sim.slice(sim.indexOf('function PresetFold'), sim.indexOf('function FullControls'));
  assert.match(fold, /accessibilityState=\{\{ expanded: open \}\}/);
  assert.match(fold, /\{open \? \(/);
  assert.doesNotMatch(fold, /<Seg\b|<ProgressBar\b|title="재생"/);
});

test('19 머리와 상태: 작은 머리말, useBack(Map), 상태 줄 칩 둘과 설명 시트, 경고는 신호 약함 한 줄', () => {
  assert.match(live, /const back = useBack\('Map'\);/);
  assert.match(live, /<Header size="sm" back=\{back\} eyebrow=\{`여행 진행 · \$\{trip\.title\}`\}/);
  assert.match(live, /<NotFound title="여행방을 찾을 수 없어요"/);
  assert.match(live, /onPress=\{\(\) => setStatusOpen\(true\)\}/);
  assert.match(live, /<Sheet visible=\{!!status && statusOpen\}/);
  assert.match(live, /<Notice icon="alert" tone="warn" text="GPS 신호가 약해 도착 판정을 잠시 멈췄어요" \/>/);
  // 진행 방식 안내 상자(수동 진행 모드, 자동 판정 안 함, 화면 밖 멈춤)를 본문에 쌓지 않는다
  assert.equal((live.match(/<Notice\b/g) ?? []).length, 2, '종료 잠금 안내와 신호 약함 경고뿐이다');
  assert.doesNotMatch(live, /<SimBanner\b/);
  assert.match(banner, /export const SIM_BANNER_TEXT = '시뮬레이터 · 실제 위치 아님';/);
  // 날짜 Seg는 감싸지 않는다(Seg가 스스로 가로로 민다)
  assert.doesNotMatch(live, /<ScrollView[^>]*horizontal/);
});

test("19 진행 중 본문 순서: 지금 카드, 지도(200)와 '지도 크게 보기', 뺀 스팟, 빈 시간, 시간표, 시뮬레이터, 기록, 끝내기", () => {
  const order = [
    '<LiveNowCard',
    '<MapCanvas',
    'title="지도 크게 보기"',
    '조정안으로 뺀 스팟',
    '<FreeTimeCard',
    '<DayTimeline',
    '<SimControls\n            preset=',
    '{running ? bgCard : null}',
    '<LogCard lines',
    'label="여행일지 보기"',
    'title="여행 진행 끝내기"',
  ];
  const at = order.map((s) => live.indexOf(s));
  at.forEach((i, k) => assert.ok(i >= 0, `${order[k]} 없음`));
  for (let k = 1; k < at.length; k++) assert.ok(at[k - 1] < at[k], `${order[k - 1]} 다음에 ${order[k]}`);
  assert.match(live, /const MAP_H = 200;/);
  assert.match(live, /navigation\.navigate\('Main', \{ screen: 'Map', params: \{ date \} \}\)/);
  // '기록 지도'와 '사진' 버튼은 '여행일지 보기' 하나로 합쳤다(기록 지도 화면은 없앴다)
  assert.doesNotMatch(live, /title="기록 지도"|title="사진"/);
});

test('19 지금 카드: 도착이면 머무는 중과 도착 취소, 아니면 다음 스팟과 예상 시각, 끝나면 마친 문구', () => {
  assert.match(nowCard, /`\$\{arrived\.name\} 도착`/);
  assert.match(nowCard, /부터 머무는 중`/);
  assert.match(nowCard, /<Btn title="도착 취소"/);
  assert.match(nowCard, /<Txt v="label">예상 도착<\/Txt>/);
  assert.match(nowCard, /<Chip text=\{next\.eta\.delta\}/);
  assert.match(nowCard, /오늘 일정을 모두 마쳤어요/);
});

test("19 빈 시간 추천: 장소를 누르면 카카오맵으로 연다(목적지만, 내 위치 없음), 닫기는 IconBtn x '빈 시간 추천 닫기'", () => {
  assert.match(free, /onPressPlace\?: \(place: Place\) => void;/);
  assert.match(free, /<IconBtn icon="x" label="빈 시간 추천 닫기" onPress=\{onClose\} \/>/);
  assert.doesNotMatch(free, /<Btn title="닫기"/);
  assert.match(live, /onPressPlace=\{openInKakao\}/);
  assert.match(live, /`https:\/\/map\.kakao\.com\/link\/to\/\$\{encodeURIComponent\(p\.name\)\},\$\{p\.coord\.latitude\},\$\{p\.coord\.longitude\}`/);
  // 링크에 출발 좌표(내 위치)를 넣지 않는다: 기기 위치 안내 '위치는 이 기기에서만 써요'를 지킨다
  const open = live.slice(live.indexOf('const openInKakao'), live.indexOf('Linking.openURL(url)'));
  assert.doesNotMatch(open, /live\.last|link\/by\/|link\/from\//);
  assert.match(live, /위치는 이 기기에서만 써요/);
  // '도보 링크'라고 하지 않는다(카카오 목적지 링크는 도보를 고르지 않는다)
  assert.doesNotMatch(live + free, /openWalk|도보 링크|도보 길찾기로 연다/);
});

test('19 빈 시간 추천: 장소 줄은 앱 밖 링크라 role link와 카카오맵으로 열기 이름, 끝 아이콘은 지도다', () => {
  assert.match(
    free,
    /<Pressable\s+key=\{p\.placeId\}\s+accessibilityRole="link"\s+accessibilityLabel=\{placeLinkLabel\(p, walk\)\}\s+onPress=\{\(\) => onPressPlace\(p\)\}/,
  );
  assert.match(free, /\[p\.name, p\.category, walk, '카카오맵으로 열기'\]\.filter\(Boolean\)\.join\(', '\)/);
  // 줄 안 Card는 누를 수 없는 Card다(role button 이름 없는 Pressable을 겹쳐 두지 않는다)
  assert.doesNotMatch(free, /<Card key=\{p\.placeId\} onPress=/);
  assert.match(free, /onPressPlace \? <Icon name="map" size=\{14\} color="muted" \/> : null/);
  assert.doesNotMatch(free, /<Icon name="right"/);
});
