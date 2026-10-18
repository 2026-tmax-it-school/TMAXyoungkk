import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p: string) => readFileSync(p, 'utf8');

/**
 * 2026-10-17 모든 화면에 뒤로 가기: 쌓인 화면은 머리말 back, 탭 맨 위 화면(후보·시간표·지도·커뮤니티·프로필 탭)은 홈 탭으로 가는 back.
 * 홈 탭만 뒤로 버튼이 없다. 채팅에서 후보를 올리는 길: 이름을 적으면 추출, 헷갈리면 '장소 검색해서 담기'(후보 탭 검색 칸을 펼쳐 연다).
 */

test('탭 맨 위 화면은 홈으로 가는 뒤로 버튼이 있다', () => {
  assert.match(read('src/navigation/useBack.ts'), /export function useHomeBack/);
  assert.match(read('src/features/trip/components/TripBar.tsx'), /back \? <IconBtn icon="back" label="뒤로"/);
  for (const f of ['CandidatesScreen', 'ScheduleScreen', 'MapScreen', 'CommunityScreen', 'MoreScreen']) {
    const s = read(`src/screens/${f}.tsx`);
    assert.match(s, /useHomeBack\(\)/, f);
    assert.match(s, /homeBack/, f);
  }
  assert.match(read('src/screens/MapScreen.tsx'), /<MapPill icon="back" label="홈"/);
  assert.doesNotMatch(read('src/screens/HomeScreen.tsx'), /useHomeBack/);
});

test('쌓이는 화면은 모두 머리말 뒤로(back)가 있다', () => {
  const root = read('src/navigation/RootNavigator.tsx');
  const names = [...root.matchAll(/<Stack\.Screen name="(\w+)" component=\{(\w+)\}/g)].map((m) => [m[1], m[2]]);
  const exempt = new Set(['Onboarding', 'Main']);
  for (const [name, comp] of names) {
    if (exempt.has(name)) continue;
    const s = read(`src/screens/${comp.replace(/Screen$/, '')}Screen.tsx`);
    assert.match(s, /back=\{|useBack\(|<Header[^>]*\bclose=/s, `${name} 뒤로 없음`);
  }
});

test('채팅에서 후보 올리기: 검색해서 담기 입구와 안내, 후보 탭이 펼친 채로 연다', () => {
  const chat = read('src/screens/ChatScreen.tsx');
  assert.match(chat, /label="장소 검색해서 담기"/);
  assert.match(chat, /params: \{ add: true \}/);
  assert.match(read('src/screens/CandidatesScreen.tsx'), /route\.params\?\.add/);
  assert.match(read('src/navigation/routes.ts'), /Candidates: \{ add\?: boolean \} \| undefined/);
});
