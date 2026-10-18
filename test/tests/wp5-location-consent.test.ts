import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';

import type { LocationPermission, LocationProvider } from '../src/core/ports';
import { consentDeclined, setLocationConsentGate, withLocationConsent, type LocationConsentChoice } from '../src/services/location/consent';

/**
 * 위치 사용 동의(2026-10-17 사용자 요청: 위치를 쓸 건지 묻는 화면). 앱 동의를 먼저 받고 그다음에 기기 권한을 묻는다.
 */

function fakeProvider(os: LocationPermission) {
  const calls = { request: 0 };
  const p: LocationProvider = {
    id: 'device',
    permission: async () => os,
    request: async () => {
      calls.request += 1;
      return os === 'denied' ? 'denied' : 'granted';
    },
    watch: () => () => undefined,
  };
  return { p, calls };
}

function gate(answer: LocationConsentChoice) {
  let granted = false;
  let asked = 0;
  setLocationConsentGate({
    granted: async () => granted,
    ask: async () => {
      asked += 1;
      if (answer !== 'deny') granted = true;
      return answer;
    },
  });
  return { asked: () => asked };
}

afterEach(() => setLocationConsentGate(undefined));

describe('withLocationConsent', () => {
  test('관문이 없으면(테스트·등록 전) 기기 권한을 그대로 통과한다', async () => {
    const { p, calls } = fakeProvider('granted');
    const w = withLocationConsent(p);
    assert.equal(await w.permission(), 'granted');
    assert.equal(await w.request(), 'granted');
    assert.equal(calls.request, 1);
  });

  test('앱 동의 전에는 기기가 허용이어도 undetermined, request가 대화상자를 먼저 띄운다', async () => {
    const { p, calls } = fakeProvider('granted');
    const g = gate('once');
    const w = withLocationConsent(p);
    assert.equal(await w.permission(), 'undetermined');
    assert.equal(await w.request(), 'granted');
    assert.equal(g.asked(), 1);
    assert.equal(calls.request, 1, '허용한 뒤 기기 권한을 묻는다');
    // 한 번 동의하면 다시 묻지 않는다
    assert.equal(await w.permission(), 'granted');
    await w.request();
    assert.equal(g.asked(), 1);
  });

  test('허용 안 함이면 기기 권한을 묻지 않고 거부, 다음 요청에서 다시 묻는다', async () => {
    const { p, calls } = fakeProvider('undetermined');
    const g = gate('deny');
    const w = withLocationConsent(p);
    assert.equal(await w.request(), 'denied');
    assert.equal(consentDeclined(), true, '앱에서 거절한 것을 기기 거부와 나눈다');
    assert.equal(calls.request, 0);
    await w.request();
    assert.equal(g.asked(), 2);
  });

  test('기기에서 이미 거부했으면 앱 대화상자 없이 denied', async () => {
    const { p } = fakeProvider('denied');
    const g = gate('once');
    const w = withLocationConsent(p);
    assert.equal(await w.permission(), 'denied');
    assert.equal(g.asked(), 0);
  });
});

test('소스 규칙: 기기 위치는 동의로 감싸고, 대화상자는 앱 루트에 하나이며 세 가지 답을 준다', () => {
  const reg = readFileSync('src/services/registry.ts', 'utf8');
  assert.match(reg, /location: withLocationConsent\(createDeviceLocation\(\)\)/);
  const app = readFileSync('App.tsx', 'utf8');
  assert.match(app, /<LocationConsentDialog \/>/);
  const dlg = readFileSync('src/features/live/components/LocationConsentDialog.tsx', 'utf8');
  for (const label of ['한 번 허용', '앱을 사용하는 동안 허용', '허용 안 함']) assert.ok(dlg.includes(`'${label}'`), label);
  assert.match(dlg, /<AlertDialog/);
});
