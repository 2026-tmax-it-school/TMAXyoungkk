import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { mailCodeFailText } from '../src/features/account/messages';
import { needsMailCode } from '../src/features/account/social';
import { GUIDE_SECTIONS, GUIDE_STEPS, stepCounter, stepsBySection, stepWhere } from '../src/features/guide/steps';

/**
 * 앱 둘러보기(2026-10-24): 모든 기능을 소개하는 안내. 내용(순수)이 빠짐없고 화면과 이어지는지 본다.
 */
const read = (p: string) => readFileSync(p, 'utf8');

test('안내 단계: 아이디가 겹치지 않고, 모든 단계에 제목·요약·방법·찾는 곳이 있고, 묶음이 맞다', () => {
  const ids = GUIDE_STEPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of GUIDE_STEPS) {
    assert.ok(s.title && s.summary && s.where, s.id);
    assert.ok(s.how.length >= 2 && s.how.length <= 4, `${s.id} 방법 줄 수`);
    assert.ok((GUIDE_SECTIONS as readonly string[]).includes(s.section), s.id);
  }
  assert.deepEqual(
    stepsBySection().map((g) => g.section),
    [...GUIDE_SECTIONS],
  );
  assert.equal(stepsBySection().flatMap((g) => g.steps).length, GUIDE_STEPS.length);
  assert.equal(stepCounter(0), `1 / ${GUIDE_STEPS.length}`);
});

test('안내가 앱의 큰 기능을 모두 소개한다(탭 5개와 주요 화면)', () => {
  const must = ['home', 'create', 'sample', 'invite', 'chat', 'candidates', 'recommend', 'schedule', 'edit', 'leg', 'map', 'directions', 'live', 'journal', 'community', 'share', 'settings', 'profile'];
  for (const id of must) assert.ok(GUIDE_STEPS.some((s) => s.id === id), `${id} 단계가 없다`);
});

test('안내 문구는 앱 용어를 따른다(금지 용어 없음)', () => {
  const all = JSON.stringify(GUIDE_STEPS);
  for (const w of ['확정 장소', '제외 장소', '투표', '출발지']) assert.ok(!all.includes(w), w);
});

test('안내의 가 보기 목적지는 화면이 모두 처리한다', () => {
  const screen = read('src/screens/GuideScreen.tsx');
  const routes = new Set(GUIDE_STEPS.flatMap((s) => (s.go ? [s.go.route] : [])));
  for (const r of routes) assert.match(screen, new RegExp(`case '${r}'`), `${r} 처리 없음`);
  // 여행방이 필요한 단계는 여행방이 없을 때 만들기로 보낸다
  assert.match(screen, /s\.go\.trip && !trip/);
  assert.match(screen, /navigation\.navigate\('CreateTrip'\)/);
});

test('안내 화면 연결: 라우트·프로필 줄·홈 카드·한 번 연 뒤 카드 숨김', () => {
  assert.match(read('src/navigation/RootNavigator.tsx'), /<Stack\.Screen name="Guide" component=\{GuideScreen\} \/>/);
  const more = read('src/screens/MoreScreen.tsx');
  assert.match(more, /label="앱 둘러보기"[\s\S]{0,160}useTour\.getState\(\)\.start\(0\)/);
  assert.match(more, /label="기능 설명 모아 보기"[\s\S]{0,160}navigation\.navigate\('Guide'\)/);
  assert.match(read('src/screens/HomeScreen.tsx'), /!guideDismissed \? <GuideInvite/);
  assert.match(read('src/screens/HomeScreen.tsx'), /useTour\.getState\(\)\.start\(0\)/);
  assert.match(read('src/screens/GuideScreen.tsx'), /dismiss\(\);/);
  const ui = read('src/store/ui.ts');
  assert.match(ui, /guideDismissed: boolean/);
  assert.match(ui, /partialize: \(s\) => \(\{[^}]*guideDismissed: s\.guideDismissed/);
});

/* ---------- 스포트라이트 안내(2026-10-24) ---------- */
import {
  holeLayout,
  rectVisible,
  tooltipBox,
  tooltipTop,
  tourCounter,
  tourSteps,
  tourText,
  TOUR_STEPS,
  TOUR_TIP_MAX_W,
} from '../src/features/guide/tour';

test('스포트라이트 단계: 여행방 유무에 맞게 고르고, 단계마다 화면·자리·설명이 있다', () => {
  const withTrip = tourSteps(true);
  const noTrip = tourSteps(false);
  assert.ok(withTrip.every((s) => s.when !== 'noTrip'));
  assert.ok(noTrip.every((s) => s.when !== 'trip'));
  assert.equal(noTrip[0].id, 'home-empty');
  assert.equal(withTrip[0].id, 'home-now');
  for (const s of TOUR_STEPS) assert.ok(s.title && s.text && s.target && s.screen, s.id);
  assert.equal(new Set(TOUR_STEPS.map((s) => s.id)).size, TOUR_STEPS.length);
  assert.equal(tourCounter(2, 12), '3 / 12');
  const all = JSON.stringify(TOUR_STEPS);
  // 2026-10-24: 후보 카드가 이름 투표라 앱 둘러보기도 '투표'를 쓴다
  for (const w of ['확정 장소', '제외 장소', '출발지']) assert.ok(!all.includes(w), w);
});

test('스포트라이트: 구멍은 화면 안으로 잘리고 그림자 네 장이 빈틈 없이 나머지를 덮는다', () => {
  const screen = { w: 390, h: 844 };
  const l = holeLayout({ x: 20, y: 100, w: 100, h: 50 }, screen, 6);
  assert.deepEqual(l.hole, { x: 14, y: 94, w: 112, h: 62 });
  const area = (r: { w: number; h: number }) => r.w * r.h;
  assert.equal(area(l.top) + area(l.bottom) + area(l.left) + area(l.right) + area(l.hole), screen.w * screen.h);
  // 화면 가장자리 밖으로 나가는 대상은 안으로 자른다
  const edge = holeLayout({ x: 300, y: 800, w: 200, h: 100 }, screen, 6);
  assert.equal(edge.hole.x + edge.hole.w, 390);
  assert.equal(edge.hole.y + edge.hole.h, 844);
});

test('스포트라이트 풍선: 대상 아래에 자리가 있으면 아래, 없으면 위, 대상이 안 보이면 가운데', () => {
  const screen = { w: 390, h: 844 };
  const top = tooltipTop({ x: 20, y: 100, w: 100, h: 50 }, screen, 200);
  assert.equal(top, 100 + 50 + 14);
  const bottom = tooltipTop({ x: 20, y: 780, w: 100, h: 50 }, screen, 200);
  assert.equal(bottom, 780 - 14 - 200);
  assert.equal(tooltipTop(undefined, screen, 200), (844 - 200) / 2);
  assert.equal(rectVisible({ x: 0, y: 900, w: 50, h: 50 }, screen), false);
  assert.equal(rectVisible({ x: 10, y: 10, w: 50, h: 50 }, screen), true);
});

test('찾는 곳 문구: 컴퓨터 폭에서는 하단 탭을 왼쪽 메뉴로 바꾼다', () => {
  const home = GUIDE_STEPS.find((s) => s.where.startsWith('하단 탭'));
  assert.ok(home);
  assert.equal(stepWhere(home, 390), home.where);
  assert.ok(stepWhere(home, 1280).startsWith('왼쪽 메뉴'));
  assert.ok(!stepWhere(home, 1280).includes('하단'));
});

test('스포트라이트 풍선 폭: 폰은 양쪽 여백만 두고, 컴퓨터는 상한에서 멈추고 대상 쪽으로 붙는다', () => {
  const phone = tooltipBox({ x: 20, y: 100, w: 100, h: 50 }, { w: 390, h: 844 }, 16);
  assert.deepEqual(phone, { left: 16, width: 358 });
  const wide = { w: 1280, h: 800 };
  assert.equal(tooltipBox(undefined, wide, 16).width, TOUR_TIP_MAX_W);
  assert.equal(tooltipBox(undefined, wide, 16).left, (1280 - TOUR_TIP_MAX_W) / 2);
  // 대상이 오른쪽 끝이면 풍선도 화면 밖으로 나가지 않는다
  const edge = tooltipBox({ x: 1200, y: 100, w: 70, h: 50 }, wide, 16);
  assert.equal(edge.left + edge.width, 1280 - 16);
  // 컴퓨터 폭에서만 wideText를 쓴다
  const chat = TOUR_STEPS.find((s) => s.id === 'chat-seg');
  assert.ok(chat?.wideText);
  assert.equal(tourText(chat, 390), chat.text);
  assert.equal(tourText(chat, 1280), chat.wideText);
  const tab = TOUR_STEPS.find((s) => s.id === 'tab-Map');
  assert.equal(tourText(tab!, 1280), tab!.text);
});

test('스포트라이트 연결: 비출 자리가 화면에 모두 표시돼 있다', () => {
  const sources = [
    'src/screens/HomeScreen.tsx',
    'src/screens/CandidatesScreen.tsx',
    'src/features/candidates/components/CandidateCard.tsx',
    'src/screens/ScheduleScreen.tsx',
    'src/screens/ChatScreen.tsx',
    'src/screens/MoreScreen.tsx',
    'src/ui/TabBar.tsx',
  ]
    .map(read)
    .join('\n');
  for (const step of TOUR_STEPS) {
    const id = step.target.startsWith('tab-') ? 'id={`tab-${it.key}`}' : `id="${step.target}"`;
    assert.ok(sources.includes(id), `${step.target} 자리 표시가 없다`);
  }
  assert.match(read('App.tsx'), /<TourOverlay \/>/);
  assert.match(read('src/features/guide/TourOverlay.tsx'), /holeLayout\(rect, screen\)/);
});

test('소셜 연결 확인: 코드가 메일로만 오면 코드 입력 칸을 띄우고, 응답에 코드가 있으면(모의) 바로 확인한다', () => {
  assert.equal(needsMailCode({ code: 'linkRequired' }), true);
  assert.equal(needsMailCode({ code: 'linkRequired', linkToken: 'abc' }), false);
  assert.equal(needsMailCode({ code: 'badCredentials' }), false);
  // 온보딩과 로그인 둘 다 칸을 달고 같은 연결 흐름(confirmLinkFlow, accept true)을 쓴다
  const hook = read('src/features/account/useSocialSignIn.ts');
  assert.match(hook, /confirmLinkFlow\(token, true\)/);
  assert.match(hook, /needsMailCode\(r\.result\)/);
  assert.match(read('src/screens/OnboardingScreen.tsx'), /<MailLinkCode busy=\{social\.mailBusy\}/);
  const login = read('src/screens/LoginScreen.tsx');
  assert.match(login, /<MailLinkCode busy=\{mailBusy\}/);
  assert.match(login, /confirmLinkFlow\(token, true\)/);
  // 틀린 코드·지난 코드는 '링크' 대신 '코드' 문구로 보인다
  assert.equal(mailCodeFailText({ code: 'invalidToken', detail: '연동 확인 시간이 지났습니다' }).title, '코드가 맞지 않아요');
  assert.notEqual(mailCodeFailText({ code: 'badCredentials' }).title, '코드가 맞지 않아요');
  // 코드 입력 칸은 tsx라 테스트가 가져오지 않는다(화면 글자만 확인)
  assert.match(read('src/features/account/components/MailLinkCode.tsx'), /메일로 받은 연결 코드/);
});
