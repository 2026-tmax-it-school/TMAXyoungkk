import assert from 'node:assert/strict';
import { test } from 'node:test';

import { providerNotice, type ProviderLine } from '../src/features/account/settings';

/**
 * 더보기 제공자 안내 한 줄(2026-10-10 리뷰). 서버가 카카오를 못 써 경로 줄이 mock으로 떨어져도
 * 도로 경로 서버가 켜져 있으면 '경로는 예시 데이터'라고 하지 않는다.
 */

const places = (p: Partial<ProviderLine>): ProviderLine => ({ key: 'places', mode: 'mock', ...p });
const routes = (p: Partial<ProviderLine>): ProviderLine => ({ key: 'routes', mode: 'mock', ...p });

test('서버 경유인데 카카오를 못 쓰고 도로 경로는 켜져 있으면 이동 시간과 길은 실제 길이라고 한다', () => {
  const text = providerNotice([places({ via: 'server' }), routes({ via: 'server', road: true })]);
  assert.match(text, /장소는 예시 데이터/);
  assert.match(text, /실제 길/);
  assert.doesNotMatch(text, /장소와 경로를 예시 데이터/);
});

test('도로 경로도 꺼져 있으면 장소와 경로 모두 예시 데이터라고 한다', () => {
  assert.match(providerNotice([places({ via: 'server' }), routes({ via: 'server', road: false })]), /장소와 경로를 예시 데이터/);
  assert.match(providerNotice([places({}), routes({ road: false })]), /장소와 경로를 예시 데이터/);
});

test('road 표시가 없으면 경로 줄 mode로 판단한다(예전 꼴과 호환)', () => {
  assert.match(providerNotice([places({}), routes({ mode: 'real' })]), /OpenStreetMap 실제 길/);
  assert.match(providerNotice([places({}), routes({ mode: 'mock' })]), /장소와 경로를 예시 데이터/);
});

test('서버 경유 카카오: 앱 .env에 키가 남아 번들에 들어가면 키는 서버에만 있다고 하지 않는다', () => {
  const clean = providerNotice([places({ mode: 'real', via: 'server' }), routes({ mode: 'real', via: 'server', road: true })]);
  assert.match(clean, /키는 서버에만/);
  const leaked = providerNotice([places({ mode: 'real', via: 'server', appKeyInBundle: true }), routes({ mode: 'real', via: 'server' })]);
  assert.doesNotMatch(leaked, /키는 서버에만/);
  assert.match(leaked, /비워 두세요/);
  assert.match(providerNotice([places({ mode: 'real', via: 'app' })]), /키가 앱에 들어가니/);
});
