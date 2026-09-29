import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Photo, Trip } from '../src/types';
import { LOGIN_LOCK_MS, PROFILE_IMAGE_MAX_BYTES, SESSION_TTL_MS } from '../src/core/constants';
import {
  compressedImageBytes,
  deviceAttemptCheck,
  formatBytes,
  needsImageCompression,
  passwordViolations,
  planAccountDeletion,
  planAccountLink,
} from '../src/core/auth';
import type { AuthResult, KV } from '../src/core/ports';
import { accountSession, touchOrExpire } from '../src/core/session';
import { createAuthProvider } from '../src/services/auth';
import { createLocalAuth } from '../src/services/auth/local';
import { promotionProfilePatch } from '../src/features/account/profile';
import { judgeSocial, LINK_MISMATCH_TEXT } from '../src/features/account/social';
import { fakeHasher, fixedClock, memoryKV, seededRng } from './helpers/fakes';
import { memberId, scenarioTrip } from './helpers/fixtures';

/**
 * WP1 모의 인증(FR-101~104, 게스트 승격, 계정 탈퇴, 2단계 보안).
 * createLocalAuth({clock,rng,hasher,kv})를 fixedClock·seededRng·순수 SHA-256·memoryKV로 돌린다.
 */

const T0 = Date.UTC(2026, 9, 1, 1, 0, 0);
const MIN = 60 * 1000;
const PW = 'trip2026ok';

function setup(seed = 11) {
  const clock = fixedClock(T0);
  const kv = memoryKV();
  const auth = createLocalAuth({ clock, rng: seededRng(seed), hasher: fakeHasher, kv });
  return { clock, kv, auth };
}

function ok(r: AuthResult) {
  assert.equal(r.ok, true, r.ok ? '' : `${r.code} ${r.detail ?? ''}`);
  if (!r.ok) throw new Error('unreachable');
  return r.account;
}

function fail(r: AuthResult) {
  assert.equal(r.ok, false);
  if (r.ok) throw new Error('unreachable');
  return r;
}

async function verifiedAccount(auth: ReturnType<typeof setup>['auth'], email = 'minji@example.com', nickname = '민지') {
  const acc = ok(await auth.signUp({ email, password: PW, nickname }));
  const mail = (await auth.outbox()).find((m) => m.to === acc.email && !m.invalidated);
  assert.ok(mail);
  ok(await auth.verifyEmail(mail.token));
  return acc;
}

async function dump(kv: KV): Promise<string> {
  return (await kv.get('index')) ?? '';
}

describe('FR-101 이메일 회원가입', () => {
  test('비밀번호 규칙 위반 항목을 모두 돌려준다', async () => {
    assert.deepEqual(passwordViolations('abc'), ['8자 이상', '숫자 포함']);
    assert.deepEqual(passwordViolations('12345678'), ['영문 포함']);
    assert.deepEqual(passwordViolations('abcdefgh1'), []);
    const { auth } = setup();
    const r = fail(await auth.signUp({ email: 'a@example.com', password: 'short', nickname: '민지' }));
    assert.equal(r.code, 'weakPassword');
    assert.deepEqual(r.violations, ['8자 이상', '숫자 포함']);
  });

  test('중복 이메일은 거부한다(대소문자·공백 무시)', async () => {
    const { auth } = setup();
    ok(await auth.signUp({ email: 'minji@example.com', password: PW, nickname: '민지' }));
    const r = fail(await auth.signUp({ email: '  MINJI@example.com ', password: PW, nickname: '민지2' }));
    assert.equal(r.code, 'duplicateEmail');
  });

  test('가입 직후는 미인증이고 모의 메일함에 인증 메일이 온다', async () => {
    const { auth } = setup();
    const acc = ok(await auth.signUp({ email: 'minji@example.com', password: PW, nickname: '민지' }));
    assert.equal(acc.verified, false);
    const mails = await auth.outbox();
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'minji@example.com');
    const v = ok(await auth.verifyEmail(mails[0].token));
    assert.equal(v.verified, true);
  });

  test('재발송하면 이전 인증 토큰은 무효가 된다', async () => {
    const { auth, clock } = setup();
    ok(await auth.signUp({ email: 'minji@example.com', password: PW, nickname: '민지' }));
    const first = (await auth.outbox())[0];
    clock.advance(MIN);
    assert.deepEqual(await auth.resendVerification('minji@example.com'), { ok: true });
    const mails = await auth.outbox();
    assert.equal(mails.length, 2);
    assert.equal(mails.find((m) => m.id === first.id)?.invalidated, true);
    assert.equal(fail(await auth.verifyEmail(first.token)).code, 'invalidToken');
    const latest = mails.find((m) => !m.invalidated);
    assert.ok(latest);
    ok(await auth.verifyEmail(latest.token));
  });

  test('비밀번호 원문은 저장하지 않고 salt + SHA-256만 둔다', async () => {
    const { auth, kv } = setup();
    ok(await auth.signUp({ email: 'minji@example.com', password: PW, nickname: '민지' }));
    const raw = await dump(kv);
    assert.ok(!raw.includes(PW));
    const rec = JSON.parse(raw).accounts[0];
    assert.match(rec.hash, /^[0-9a-f]{64}$/);
    assert.ok(rec.salt.length >= 16);
    assert.notEqual(rec.hash, await fakeHasher.sha256(PW));
  });

  test('팩토리 createAuthProvider도 같은 모의 인증이다', async () => {
    const auth = createAuthProvider({ clock: fixedClock(T0), rng: seededRng(2), hasher: fakeHasher, kv: memoryKV() });
    ok(await auth.signUp({ email: 'x@example.com', password: PW, nickname: '엑스' }));
  });
});

describe('FR-102 로그인·로그아웃과 시도 제한', () => {
  test('미인증 계정은 로그인할 수 없다', async () => {
    const { auth } = setup();
    ok(await auth.signUp({ email: 'minji@example.com', password: PW, nickname: '민지' }));
    const r = fail(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' }));
    assert.equal(r.code, 'unverified');
  });

  test('인증 뒤 로그인하면 가입 때와 같은 userId다(로그아웃 뒤 여행방 이어 쓰기)', async () => {
    const { auth } = setup();
    const acc = await verifiedAccount(auth);
    const a = ok(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' }));
    assert.equal(a.userId, acc.userId);
    const b = ok(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' }));
    assert.equal(b.userId, acc.userId);
  });

  test('5회 연속 틀리면 10분 잠금, 9분 59초에는 잠김, 10분 1초 뒤 해제', async () => {
    const { auth, clock } = setup();
    await verifiedAccount(auth);
    const bad = () => auth.signIn({ email: 'minji@example.com', password: 'wrong1234', deviceToken: 'dev-a' });
    for (let i = 1; i <= 4; i += 1) assert.equal(fail(await bad()).code, 'badCredentials');
    const fifth = fail(await bad());
    assert.equal(fifth.code, 'locked');
    assert.equal(fifth.retryAt, T0 + LOGIN_LOCK_MS);
    // 잠긴 동안에는 맞는 비밀번호도 거부한다
    clock.set(T0 + LOGIN_LOCK_MS - 1000);
    assert.equal(fail(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' })).code, 'locked');
    clock.set(T0 + LOGIN_LOCK_MS + 1000);
    ok(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' }));
  });

  test('중간에 성공하면 연속 실패 수가 0으로 돌아간다', async () => {
    const { auth } = setup();
    await verifiedAccount(auth);
    const bad = () => auth.signIn({ email: 'minji@example.com', password: 'wrong1234', deviceToken: 'dev-a' });
    for (let i = 0; i < 4; i += 1) await bad();
    ok(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' }));
    for (let i = 0; i < 4; i += 1) assert.equal(fail(await bad()).code, 'badCredentials');
  });

  test('기기 토큰 기준 10분 20회 제한은 계정과 따로 센다(IP 대체 가정)', async () => {
    const { auth, clock } = setup();
    await verifiedAccount(auth);
    for (let i = 0; i < 20; i += 1) {
      clock.set(T0 + i * 1000);
      // 계정마다 다른 이메일이라 계정 잠금은 걸리지 않는다
      assert.equal(fail(await auth.signIn({ email: `nobody${i}@example.com`, password: 'x', deviceToken: 'dev-a' })).code, 'badCredentials');
    }
    clock.set(T0 + 21 * 1000);
    const limited = fail(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' }));
    assert.equal(limited.code, 'deviceLimited');
    assert.equal(limited.retryAt, T0 + 10 * MIN);
    // 다른 기기는 막히지 않는다
    ok(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-b' }));
    // 창이 지나면 다시 된다
    clock.set(T0 + 10 * MIN + 20 * 1000);
    ok(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' }));
  });

  test('동시에 틀려도 실패 수가 덮이지 않는다(호출을 차례로 처리)', async () => {
    const { auth } = setup();
    await verifiedAccount(auth);
    const bad = () => auth.signIn({ email: 'minji@example.com', password: 'wrong1234', deviceToken: 'dev-a' });
    const results = await Promise.all([bad(), bad(), bad(), bad(), bad(), bad()]);
    assert.deepEqual(
      results.map((r) => (r.ok ? 'ok' : r.code)),
      ['badCredentials', 'badCredentials', 'badCredentials', 'badCredentials', 'locked', 'locked'],
    );
    assert.equal(fail(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' })).code, 'locked');
  });

  test('deviceAttemptCheck 경계: 19회까지 허용, 20회째 기록 뒤 막힘', () => {
    const at = Array.from({ length: 19 }, (_, i) => T0 + i);
    assert.deepEqual(deviceAttemptCheck(at, T0 + 100), { ok: true });
    const r = deviceAttemptCheck([...at, T0 + 19], T0 + 100);
    assert.equal(r.ok, false);
  });

  test('계정 세션은 30일이고 사용할 때 갱신, 지나면 만료(재로그인 안내)', async () => {
    const { auth } = setup();
    const acc = await verifiedAccount(auth);
    const s = accountSession({ account: acc, deviceToken: 'dev-a', rng: seededRng(1), now: T0 });
    assert.equal(s.expiresAt, T0 + SESSION_TTL_MS);
    const used = touchOrExpire(s, T0 + 20 * 24 * 60 * MIN);
    assert.equal(used.state, 'ok');
    if (used.state === 'ok') assert.equal(used.session.expiresAt, T0 + 20 * 24 * 60 * MIN + SESSION_TTL_MS);
    assert.equal(touchOrExpire(s, T0 + SESSION_TTL_MS + 1).state, 'expired');
  });
});

describe('FR-103 소셜 로그인(모의)', () => {
  test('정상: 소셜 계정을 만들고 다시 오면 같은 계정이다', async () => {
    const { auth } = setup();
    const a = ok(await auth.social({ provider: 'kakao', deviceToken: 'dev-a', scenario: 'ok' }));
    assert.deepEqual(a.providers, ['kakao']);
    const b = ok(await auth.social({ provider: 'kakao', deviceToken: 'dev-a', scenario: 'ok' }));
    assert.equal(b.accountId, a.accountId);
  });

  test('제공자 실패는 providerFailed다', async () => {
    const { auth } = setup();
    assert.equal(fail(await auth.social({ provider: 'google', deviceToken: 'dev-a', scenario: 'fail' })).code, 'providerFailed');
  });

  test('같은 이메일은 linkRequired를 거쳐 확인해야만 연결한다(자동 병합 없음)', async () => {
    const { auth, kv } = setup();
    const acc = await verifiedAccount(auth);
    const same = { provider: 'kakao' as const, deviceToken: 'dev-a', scenario: 'sameEmail' as const, providerEmail: ' MINJI@example.com ' };
    const r = fail(await auth.social(same));
    assert.equal(r.code, 'linkRequired');
    assert.ok(r.linkToken);
    // 확인 전에는 연결되지 않았고 새 계정도 생기지 않았다
    const db = JSON.parse(await dump(kv));
    assert.equal(db.accounts.length, 1);
    assert.deepEqual(db.accounts[0].providers, ['email']);
    const declined = fail(await auth.confirmLink({ linkToken: r.linkToken, accept: false }));
    assert.equal(declined.code, 'linkRequired');
    const again = fail(await auth.social(same));
    assert.ok(again.linkToken);
    const linked = ok(await auth.confirmLink({ linkToken: again.linkToken, accept: true }));
    assert.equal(linked.accountId, acc.accountId);
    assert.deepEqual(linked.providers, ['email', 'kakao']);
    // 한 번 쓴 연동 토큰은 다시 쓸 수 없다
    assert.equal(fail(await auth.confirmLink({ linkToken: again.linkToken, accept: true })).code, 'invalidToken');
    // 연결 뒤에는 정상 소셜 로그인이 같은 계정이다
    assert.equal(ok(await auth.social({ provider: 'kakao', deviceToken: 'dev-a', scenario: 'ok' })).accountId, acc.accountId);
  });

  test('연결 대상은 모의 제공자가 돌려준 이메일과 같은 계정이다', async () => {
    const { auth, clock } = setup();
    await verifiedAccount(auth, 'a@example.com', '민지');
    clock.advance(MIN);
    const b = await verifiedAccount(auth, 'b@example.com', '준호');
    // 이 기기에서 마지막으로 로그인한 계정(a)과 상관없이 제공자 이메일(b)로 정한다
    ok(await auth.signIn({ email: 'a@example.com', password: PW, deviceToken: 'dev-a' }));
    const r = fail(
      await auth.social({ provider: 'google', deviceToken: 'dev-a', scenario: 'sameEmail', providerEmail: 'b@example.com' }),
    );
    assert.ok(r.linkToken);
    assert.equal(ok(await auth.confirmLink({ linkToken: r.linkToken, accept: true })).accountId, b.accountId);
  });

  test('제공자 이메일이 없거나 가입 계정이 없으면 notFound, 미인증 계정이면 unverified', async () => {
    const { auth } = setup();
    ok(await auth.signUp({ email: 'minji@example.com', password: PW, nickname: '민지' }));
    const base = { provider: 'kakao' as const, deviceToken: 'dev-a', scenario: 'sameEmail' as const };
    assert.equal(fail(await auth.social(base)).code, 'notFound');
    assert.equal(fail(await auth.social({ ...base, providerEmail: 'nobody@example.com' })).code, 'notFound');
    assert.equal(fail(await auth.social({ ...base, providerEmail: 'minji@example.com' })).code, 'unverified');
  });

  test('거절하면 기존 계정 제공자 목록이 그대로다', async () => {
    const { auth, kv } = setup();
    await verifiedAccount(auth);
    const r = fail(
      await auth.social({ provider: 'google', deviceToken: 'dev-a', scenario: 'sameEmail', providerEmail: 'minji@example.com' }),
    );
    assert.ok(r.linkToken);
    await auth.confirmLink({ linkToken: r.linkToken, accept: false });
    const rec = JSON.parse(await dump(kv)).accounts[0];
    assert.deepEqual(rec.providers, ['email']);
  });

  test('17 연결(linkToAccountId)은 지금 계정에만 붙이고 새 계정을 만들지 않는다', async () => {
    const { auth, kv } = setup();
    const acc = await verifiedAccount(auth);
    const r = ok(await auth.social({ provider: 'kakao', deviceToken: 'dev-a', scenario: 'ok', linkToAccountId: acc.accountId }));
    assert.equal(r.accountId, acc.accountId);
    assert.equal(r.userId, acc.userId);
    assert.deepEqual(r.providers, ['email', 'kakao']);
    assert.equal(JSON.parse(await dump(kv)).accounts.length, 1);
    // 이미 다른 계정에 묶인 제공자 신원은 연결하지 않는다
    const other = await verifiedAccount(auth, 'b@example.com', '준호');
    const bound = fail(
      await auth.social({ provider: 'kakao', deviceToken: 'dev-a', scenario: 'ok', linkToAccountId: other.accountId }),
    );
    assert.equal(bound.code, 'duplicateEmail');
    // 제공자 실패는 연결 모드에서도 providerFailed다
    assert.equal(
      fail(await auth.social({ provider: 'google', deviceToken: 'dev-a', scenario: 'fail', linkToAccountId: acc.accountId })).code,
      'providerFailed',
    );
  });

  test('judgeSocial: 연결 모드에서 결과 계정이 지금 계정과 다르면 세션을 바꾸지 않고 거부한다', async () => {
    const { auth } = setup();
    const acc = await verifiedAccount(auth);
    const same = ok(await auth.social({ provider: 'kakao', deviceToken: 'dev-a', scenario: 'ok', linkToAccountId: acc.accountId }));
    assert.deepEqual(judgeSocial('link', { ok: true, account: same }, acc.accountId), { kind: 'linked' });
    // 계약만 따르는 제공자가 새 소셜 계정을 돌려준 경우
    const fresh = ok(await auth.social({ provider: 'google', deviceToken: 'dev-a', scenario: 'ok' }));
    const j = judgeSocial('link', { ok: true, account: fresh }, acc.accountId);
    assert.equal(j.kind, 'fail');
    if (j.kind === 'fail') assert.equal(j.result.detail, LINK_MISMATCH_TEXT);
    // 로그인한 계정이 없으면 연결하지 않는다
    assert.equal(judgeSocial('link', { ok: true, account: same }, undefined).kind, 'fail');
    // 로그인 모드: 성공은 로그인, linkRequired는 확인, 실패는 실패
    assert.deepEqual(judgeSocial('login', { ok: true, account: fresh }), { kind: 'signIn' });
    const confirm = judgeSocial('login', { ok: false, code: 'linkRequired', linkToken: 't1', detail: '연결할까요?' });
    assert.deepEqual(confirm, { kind: 'confirm', linkToken: 't1', text: '연결할까요?' });
    assert.equal(judgeSocial('link', { ok: false, code: 'linkRequired', linkToken: 't1' }, acc.accountId).kind, 'fail');
    assert.equal(judgeSocial('login', { ok: false, code: 'providerFailed' }).kind, 'fail');
  });
});

describe('FR-104 프로필', () => {
  test('닉네임 중복을 거부한다(본인 계정은 예외)', async () => {
    const { auth } = setup();
    const a = await verifiedAccount(auth, 'a@example.com', '민지');
    const b = await verifiedAccount(auth, 'b@example.com', '준호');
    assert.equal(await auth.isNicknameTaken('민지'), true);
    assert.equal(await auth.isNicknameTaken(' 민지 ', a.accountId), false);
    assert.equal(fail(await auth.updateProfile(b.accountId, { nickname: '민지' })).code, 'nicknameTaken');
    assert.equal(fail(await auth.signUp({ email: 'c@example.com', password: PW, nickname: '준호' })).code, 'nicknameTaken');
  });

  test('성향 태그를 저장하면 로그인 때 그대로 돌아온다', async () => {
    const { auth } = setup();
    const a = await verifiedAccount(auth);
    ok(await auth.updateProfile(a.accountId, { tags: ['역사', '카페'] }));
    const again = ok(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' }));
    assert.deepEqual(again.profile.tags, ['역사', '카페']);
  });

  test('5MB 초과 이미지는 압축 대상이고 압축 뒤 한도 안이다', () => {
    assert.equal(needsImageCompression(PROFILE_IMAGE_MAX_BYTES), false);
    assert.equal(needsImageCompression(PROFILE_IMAGE_MAX_BYTES + 1), true);
    const big = 8 * 1024 * 1024;
    const after = compressedImageBytes(big);
    assert.ok(after < PROFILE_IMAGE_MAX_BYTES);
    assert.ok(after < big);
    assert.equal(compressedImageBytes(1024 * 1024), 1024 * 1024);
    assert.equal(formatBytes(big), '8.0MB');
    assert.equal(formatBytes(300 * 1024), '300KB');
  });
});

/* ---------- 게스트 승격·계정 탈퇴 ---------- */

function tripWithPhotos(): Trip {
  const t = scenarioTrip();
  const photo = (id: string, key: 'minji' | 'junho' | 'sua'): Photo => ({
    id,
    memberId: memberId(key),
    sim: { label: id, tone: 1 },
    bytes: 1000,
    originalBytes: 1000,
    compressed: false,
    takenAt: T0,
    source: 'exif',
    uploadedAt: T0,
  });
  return { ...t, photos: [photo('p1', 'minji'), photo('p2', 'junho'), photo('p3', 'minji')] };
}

describe('게스트 승격', () => {
  test('승격 때 게스트 때 고른 성향 태그와 이미지 정보를 계정에 올린다(이 기기 데이터 유지)', async () => {
    const { auth } = setup();
    const local = { nickname: '민지', tags: ['역사', '카페'], imageBytes: 1200, imageCompressed: true, imageUri: 'file:///a.jpg' };
    const acc = ok(await auth.signUp({ email: 'minji@example.com', password: PW, nickname: '민지', userId: 'u-minji' }));
    const patch = promotionProfilePatch(local, acc.profile);
    assert.deepEqual(patch, { tags: ['역사', '카페'], imageUri: 'file:///a.jpg', imageBytes: 1200, imageCompressed: true });
    ok(await auth.updateProfile(acc.accountId, patch ?? {}));
    const mail = (await auth.outbox()).find((m) => !m.invalidated);
    assert.ok(mail);
    ok(await auth.verifyEmail(mail.token));
    const again = ok(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' }));
    assert.equal(again.userId, 'u-minji');
    assert.deepEqual(again.profile.tags, ['역사', '카페']);
    assert.equal(again.profile.imageBytes, 1200);
    assert.equal(again.profile.nickname, '민지');
  });

  test('올릴 로컬 프로필이 없거나 계정에 이미 있으면 덮어쓰지 않는다', () => {
    assert.equal(promotionProfilePatch({ nickname: '민지', tags: [] }, { nickname: '민지', tags: [] }), null);
    assert.equal(promotionProfilePatch({ nickname: '민지', tags: ['휴식'] }, { nickname: '민지', tags: ['역사'] }), null);
    assert.deepEqual(promotionProfilePatch({ nickname: '게스트명', tags: ['휴식'] }, { nickname: '민지', tags: [] }), {
      tags: ['휴식'],
    });
  });

  test('게스트 userId로 가입하면 계정 userId가 같다', async () => {
    const { auth } = setup();
    const acc = ok(await auth.signUp({ email: 'minji@example.com', password: PW, nickname: '민지', userId: 'u-minji' }));
    assert.equal(acc.userId, 'u-minji');
  });

  test('참여 중인 방마다 member/accountLinked 하나를 본인 멤버로 보낸다', () => {
    const t = scenarioTrip();
    const other = { ...scenarioTrip(), id: 'trip-other', members: scenarioTrip().members.filter((m) => m.userId !== 'u-minji') };
    const plan = planAccountLink([t, other], 'u-minji');
    assert.equal(plan.length, 1);
    assert.equal(plan[0].tripId, t.id);
    assert.equal(plan[0].actorId, memberId('minji'));
    assert.deepEqual(plan[0].drafts, [{ type: 'member/accountLinked', userId: 'u-minji' }]);
  });

  test('나간 방·삭제된 방·이미 계정인 멤버는 빼고 보낸다', () => {
    const base = scenarioTrip();
    const left = {
      ...base,
      id: 'trip-left',
      members: base.members.map((m) => (m.userId === 'u-minji' ? { ...m, leftAt: T0 } : m)),
    };
    const deleted = { ...base, id: 'trip-del', deletedAt: T0 };
    const linked = {
      ...base,
      id: 'trip-acc',
      members: base.members.map((m) => (m.userId === 'u-minji' ? { ...m, isGuest: false } : m)),
    };
    assert.deepEqual(planAccountLink([left, deleted, linked], 'u-minji'), []);
  });
});

describe('계정 탈퇴(데이터 보존)', () => {
  test('방마다 본인 사진의 photoRemoved와 본인 멤버의 anonymize를 만든다', () => {
    const t = tripWithPhotos();
    const plan = planAccountDeletion([t], 'u-minji');
    assert.equal(plan.length, 1);
    assert.equal(plan[0].actorId, memberId('minji'));
    assert.deepEqual(plan[0].drafts, [
      { type: 'journal/photoRemoved', photoId: 'p1' },
      { type: 'journal/photoRemoved', photoId: 'p3' },
      { type: 'member/anonymize', memberId: memberId('minji') },
    ]);
  });

  test('남의 사진·채팅·제안은 건드리지 않는다(초안에 없다)', () => {
    const plan = planAccountDeletion([tripWithPhotos()], 'u-minji');
    const types = new Set(plan.flatMap((p) => p.drafts.map((d) => d.type)));
    assert.deepEqual([...types].sort(), ['journal/photoRemoved', 'member/anonymize']);
    assert.ok(!plan.flatMap((p) => p.drafts).some((d) => d.type === 'journal/photoRemoved' && d.photoId === 'p2'));
  });

  test('나간 방도 포함하고, 이미 익명 처리된 멤버는 다시 보내지 않는다', () => {
    const base = tripWithPhotos();
    const left = {
      ...base,
      id: 'trip-left',
      photos: [],
      members: base.members.map((m) => (m.userId === 'u-minji' ? { ...m, leftAt: T0, leftReason: 'left' as const } : m)),
    };
    const done = {
      ...base,
      id: 'trip-done',
      photos: [],
      members: base.members.map((m) => (m.userId === 'u-minji' ? { ...m, anonymized: true } : m)),
    };
    const plan = planAccountDeletion([left, done], 'u-minji');
    assert.deepEqual(
      plan.map((p) => p.tripId),
      ['trip-left'],
    );
  });

  test('참여하지 않은 사람은 초안이 비어 있다', () => {
    assert.deepEqual(planAccountDeletion([tripWithPhotos()], 'u-nobody'), []);
  });

  test('deleteAccount 뒤에는 로그인할 수 없고 같은 이메일로 다시 가입할 수 있다', async () => {
    const { auth } = setup();
    const acc = await verifiedAccount(auth);
    assert.deepEqual(await auth.deleteAccount(acc.accountId), { ok: true });
    assert.equal(fail(await auth.signIn({ email: 'minji@example.com', password: PW, deviceToken: 'dev-a' })).code, 'badCredentials');
    assert.equal((await auth.outbox()).length, 0);
    ok(await auth.signUp({ email: 'minji@example.com', password: PW, nickname: '민지' }));
    assert.equal((await auth.deleteAccount('acc_none')).ok, false);
  });

  test('reset은 모의 계정 저장분을 비운다(시연 리셋)', async () => {
    const { auth, kv } = setup();
    await verifiedAccount(auth);
    await auth.reset();
    assert.equal(await kv.get('index'), null);
    assert.equal((await auth.outbox()).length, 0);
  });
});
