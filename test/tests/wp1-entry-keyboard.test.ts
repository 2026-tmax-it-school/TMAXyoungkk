import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { authFailText, GUEST_LIMIT_HELP, guestNowTitle, signUpFailText } from '../src/features/account/messages';

/**
 * WP1 진입·계정 입력 화면 UX(2026-10-12 정리, B3).
 * - 순수 문구: 게스트 한계 안내, 지금 게스트라는 경고 제목(받침), 인증 실패 제목의 '~요' 톤.
 * - 소스 규칙: 온보딩·초대 수락·로그인·회원가입·소셜 동의는 Screen keyboard를 켜고, 마지막 입력 칸 Enter가 주 동작이다.
 *   앞 칸은 Enter로 다음 칸에 포커스를 넘긴다. 같은 이메일 연결 확인은 ConfirmSheet('연결하지 않기')다.
 *   계정찾기 시트는 '비밀번호 재설정'이고 서버 설정 이름을 화면에 쓰지 않는다.
 * - 리뷰 반영(B3): 회원가입 1단계는 받은 인증 메일 안내를 입력 칸보다 위에 둔다(로그인 '다시 받기'에서 와도 바로 보이게).
 *   세션 없이 앞서 보낸 가입이 닉네임을 잡고 있어 막히면 이유와 메일함으로 돌아가는 동작을 보인다.
 *   초대 수락은 온보딩이 넘긴 닉네임을 경로에서 지운다(웹 주소에 남지 않게).
 */

const read = (p: string) => readFileSync(p, 'utf8');
/** 주석을 뺀 소스(설명 문장에 같은 낱말이 있어도 규칙 검사가 흔들리지 않게) */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ONBOARDING = 'src/screens/OnboardingScreen.tsx';
const INVITE = 'src/screens/InviteAcceptScreen.tsx';
const LOGIN = 'src/screens/LoginScreen.tsx';
const SIGNUP = 'src/screens/SignupScreen.tsx';
const SOCIAL = 'src/screens/SocialConsentScreen.tsx';
const FIND = 'src/features/account/FindAccountSheet.tsx';

/** 소스에서 마지막 <Field ... /> 한 덩어리 */
function lastField(src: string): string {
  const at = src.lastIndexOf('<Field');
  assert.ok(at >= 0, 'Field가 없다');
  return src.slice(at, src.indexOf('/>', at));
}

/** 이름 있는 Field(label)의 한 덩어리 */
function fieldBy(src: string, label: string): string {
  const at = src.indexOf(`label="${label}"`);
  assert.ok(at >= 0, label);
  const start = src.lastIndexOf('<Field', at);
  return src.slice(start, src.indexOf('/>', at));
}

describe('진입 화면 문구(순수)', () => {
  test("게스트 한계 안내는 '~요' 한 문장 둘이고 30일·이 기기·복구 불가를 말한다", () => {
    assert.equal(GUEST_LIMIT_HELP, '이 기기에서만 쓰는 게스트예요. 기기를 바꾸거나 30일 동안 안 쓰면 복구할 수 없어요.');
    assert.doesNotMatch(GUEST_LIMIT_HELP, /니다/);
  });

  test('지금 게스트 경고 제목은 받침에 맞춘다', () => {
    assert.equal(guestNowTitle('민지'), '지금은 게스트 민지예요');
    assert.equal(guestNowTitle('지훈'), '지금은 게스트 지훈이에요');
    assert.equal(guestNowTitle(' Mina '), '지금은 게스트 Mina예요');
  });

  test("인증 실패 제목과 다시 시도 안내는 '~요' 톤이다", () => {
    for (const c of ['duplicateEmail', 'locked', 'badCredentials', 'invalidToken', 'notFound'] as const) {
      assert.doesNotMatch(authFailText({ code: c }).title, /니다/, c);
    }
    assert.match(authFailText({ code: 'locked', retryAt: Date.UTC(2026, 9, 18, 3, 10) }).text, /12:10부터 다시 시도할 수 있어요\./);
  });

  test('회원가입: 앞서 보낸 가입(인증 전)이 같은 닉네임을 잡고 있으면 이유와 그 주소를 돌려준다', () => {
    const held = { email: 'typo@exmple.com', nickname: '민지' };
    const fail = { code: 'nicknameTaken' as const, detail: '이미 쓰는 닉네임이에요' };
    const r = signUpFailText(fail, ' 민지 ', held);
    assert.equal(r.title, '앞서 보낸 가입이 쓰는 닉네임이에요');
    assert.match(r.text, /^typo@exmple\.com로 보낸 가입이 인증 전이라 이 닉네임을 아직 쓸 수 없어요\./);
    assert.match(r.text, /다른 닉네임으로 가입하거나 보낸 메일에서 인증해 주세요\.$/);
    assert.doesNotMatch(`${r.title} ${r.text}`, /니다/);
    assert.equal(r.heldEmail, 'typo@exmple.com');
    // 다른 닉네임, 앞서 보낸 가입 없음(게스트 승격은 대체되므로 넘기지 않는다), 다른 실패는 authFailText 그대로
    assert.deepEqual(signUpFailText(fail, '지훈', held), authFailText(fail));
    assert.deepEqual(signUpFailText(fail, '민지'), authFailText(fail));
    const dup = { code: 'duplicateEmail' as const, detail: 'x' };
    assert.deepEqual(signUpFailText(dup, '민지', held), authFailText(dup));
    assert.equal(signUpFailText(fail, '지훈', held).heldEmail, undefined);
  });
});

describe('진입 화면 소스 규칙', () => {
  test('다섯 화면 모두 Screen keyboard를 켠다', () => {
    for (const f of [ONBOARDING, INVITE, LOGIN, SIGNUP, SOCIAL]) {
      assert.match(code(f), /<Screen keyboard>/, f);
    }
  });

  test('네 화면의 마지막 입력 칸은 Enter로 주 동작을 한다', () => {
    assert.match(lastField(code(ONBOARDING)), /onSubmitEditing=\{start\}/);
    assert.match(code(ONBOARDING), /const start = \(\) => \{[\s\S]{0,120}createGuest\(/);
    assert.match(lastField(code(INVITE)), /onSubmitEditing=\{\(\) => \{\s*if \(!joining && who\) void join\(\);/);
    assert.match(lastField(code(LOGIN)), /onSubmitEditing=\{\(\) => void submit\(\)\}/);
    assert.match(lastField(code(SIGNUP)), /onSubmitEditing=\{\(\) => \{\s*if \(canSubmit\) void submit\(\);/);
    // 초대 코드 칸(2026-10-23 피그마 최종안: 글자 칸 CodeCells)도 Enter로 확인한다
    assert.match(code(INVITE), /<CodeCells label="초대 코드"[^>]*onSubmitEditing=\{submitCode\}/);
  });

  test('앞 칸은 Enter로 다음 칸에 포커스를 넘긴다(로그인 2칸, 회원가입 3칸)', () => {
    const login = code(LOGIN);
    assert.match(fieldBy(login, '아이디 또는 이메일'), /kind="username"[\s\S]*returnKeyType="next"[\s\S]*passwordRef\.current\?\.focus\(\)/);
    assert.match(fieldBy(login, '비밀번호'), /kind="password"[\s\S]*inputRef=\{\(el\) => \{\s*passwordRef\.current = el;/);
    const signup = code(SIGNUP);
    assert.match(fieldBy(signup, '이메일'), /kind="email"[\s\S]*passwordRef\.current\?\.focus\(\)/);
    assert.match(fieldBy(signup, '비밀번호'), /kind="newPassword"[\s\S]*inputRef=\{\(el\) => \{\s*passwordRef\.current = el;[\s\S]*nicknameRef\.current\?\.focus\(\)/);
    assert.match(fieldBy(signup, '닉네임(로그인 아이디)'), /kind="nickname"[\s\S]*inputRef=\{\(el\) => \{\s*nicknameRef\.current = el;/);
    // 비밀번호 칸은 kind가 가린다(secure를 따로 주지 않는다)
    assert.doesNotMatch(login + signup + code(FIND), /\bsecure\b/);
  });

  test('계정찾기 시트의 칸 종류는 이메일·새 비밀번호다', () => {
    const src = code(FIND);
    assert.match(fieldBy(src, '가입한 이메일'), /kind="email"[\s\S]*onSubmitEditing=\{\(\) => void request\(\)\}/);
    assert.match(fieldBy(src, '새 비밀번호'), /kind="newPassword"[\s\S]*onSubmitEditing=\{\(\) => void save\(\)\}/);
  });

  test('게스트 한계 안내는 온보딩 닉네임 칸과 세션 없는 초대 수락 이름 칸 두 곳에서 쓴다', () => {
    assert.match(fieldBy(code(ONBOARDING), '내 닉네임'), /help=\{GUEST_LIMIT_HELP\}/);
    assert.match(fieldBy(code(INVITE), '이 여행방에서 쓸 이름'), /help=\{!session \? GUEST_LIMIT_HELP : undefined\}/);
  });

  test('같은 이메일 연결 확인은 ConfirmSheet이고 취소 글자는 연결하지 않기다(로그인·소셜 동의)', () => {
    for (const f of [LOGIN, SOCIAL]) {
      const src = code(f);
      assert.match(src, /<ConfirmSheet[\s\S]{0,400}title="기존 계정에 연결할까요"[\s\S]{0,300}confirmLabel="연결하기"\s*cancelLabel="연결하지 않기"/, f);
      assert.match(src, /연결하면 두 로그인 방법이 같은 여행방을 봐요/, f);
      assert.doesNotMatch(src, /<Card variant="tinted">/, `${f}: 연결 확인 카드를 목록 안에 두지 않는다`);
    }
  });

  test("로그인: 게스트 경고는 한 줄과 '계정으로 바꾸기' 버튼이고, 회원가입 버튼은 하나뿐이다", () => {
    const src = code(LOGIN);
    assert.match(src, /title=\{guestNowTitle\(session\.nickname\)\}/);
    assert.match(src, /<Btn title="계정으로 바꾸기\(여행방 유지\)" variant="ghost" size="sm"/);
    assert.equal(src.split('title="회원가입"').length - 1, 1, "'회원가입' 제목 버튼은 하나(wp1-oauth 순서 테스트)");
    assert.match(src, /<Screen keyboard>\s*<View[\s\S]{0,200}onPress=\{back\}/, '뒤로 버튼은 늘 있다');
  });

  test("소셜 동의: Foot에는 주 동작 하나뿐이고 연결 확인 중에도 회색 처리하지 않는다", () => {
    const src = code(SOCIAL);
    const foot = src.slice(src.indexOf('<Foot>'), src.indexOf('</Foot>'));
    assert.equal(foot.split('<Btn').length - 1, 1);
    assert.doesNotMatch(src, /title="취소"/);
    assert.doesNotMatch(foot, /\blink\b/, '연결 확인 시트가 열려 있어도 주 버튼 모양은 그대로다');
    assert.match(src, /close=\{close\}/);
  });

  test("온보딩: 로그인(카카오·구글·이메일)을 같이 띄우고, 돌아온 사용자는 '다시 로그인하기'가 주 버튼, 닉네임을 넘기는 초대 합류", () => {
    const src = code(ONBOARDING);
    assert.match(src, /expiredKind === 'account'/);
    assert.match(src, /text="로그인이 끝났어요\. 다시 로그인하면 여행방을 이어 써요"/);
    assert.match(src, /\{returning \? <Btn title="다시 로그인하기" onPress=\{login\} \/> : null\}/);
    assert.match(src, /title="게스트로 시작하기" variant=\{returning \? 'ghost' : 'primary'\}/);
    assert.match(src, /onPress=\{\(\) => void social\.start\('kakao'\)\}/, '카카오 로그인을 이 화면에서 바로 연다');
    assert.match(src, /onPress=\{\(\) => void social\.start\('google'\)\}/);
    assert.match(src, /title="이메일로 로그인 · 회원가입" variant="outline" onPress=\{login\}/);
    assert.match(src, /useSocialSignIn\(navigation\)/);
    assert.match(src, /navigate\('InviteAccept', name \? \{ nickname: name \} : undefined\)/);
  });

  test("초대 수락: Foot은 합류와 '초대 거절'뿐, 시연 합류는 이름 칸 아래 글자 링크와 line 칩, 제목은 고정", () => {
    const src = code(INVITE);
    const preview = src.slice(src.indexOf('<TripSummary trip={trip} />'));
    const foot = preview.slice(preview.indexOf('<Foot>'), preview.indexOf('</Foot>'));
    assert.equal(foot.split('<Btn').length - 1, 3, '합류(이미 참여면 들어가기) 하나와 초대 거절');
    assert.match(foot, /title="초대 거절" variant="quiet"/);
    assert.doesNotMatch(foot, /시연/);
    assert.ok(preview.indexOf("'다른 사람으로 합류(시연)'") > preview.indexOf('label="이 여행방에서 쓸 이름"'));
    assert.match(preview, /<TextLink title=\{demoOther \? '나로 합류하기' : '다른 사람으로 합류\(시연\)'\}/);
    assert.match(preview, /<Chip text="시연 · 새 멤버로 합류" tone="line" \/>/);
    assert.match(src, /`\$\{host\?\.nickname \?\? '방장'\}님이 여행방에 초대했어요`/);
    assert.doesNotMatch(src, /님을\\n여행방에/, '입력한 이름으로 제목 줄 수가 바뀌지 않는다');
    assert.match(src, /route\.params\?\.nickname/);
    // 넘겨받은 닉네임은 이름 칸에 담은 뒤 경로에서 지운다(웹 주소 ?nickname=에 남아 초대 링크와 같이 퍼지지 않게)
    assert.match(src, /if \(passedNick\) navigation\.setParams\(\{ nickname: undefined \}\);/);
  });

  test("회원가입: 입력 단계와 메일 확인 단계로 나누고, 메일 카드에 토큰 조각을 보이지 않는다", () => {
    const src = code(SIGNUP);
    assert.match(src, /if \(sentTo\) \{/);
    assert.match(src, /<AuthTitle title="메일을 확인해 주세요"/);
    assert.match(src, /`\$\{sentTo\}로 보냈어요`/);
    assert.match(src, /title="이메일 바꾸기"/);
    assert.match(src, /title="인증 메일 다시 받기" size="sm" variant="quiet"/);
    assert.doesNotMatch(src, /링크 끝|token\.slice/);
    assert.doesNotMatch(src, /<Notice\s+icon="user"/, '승격은 보조 줄 한 줄로만 알린다');
    const raw = read(SIGNUP);
    assert.ok(raw.lastIndexOf("'가입하고 인증 메일 받기'") > raw.indexOf('/* ---------- 1단계'), '가입 버튼은 입력 단계에만 있다');
  });

  test("가입만 하고 나간 사람: 로그인의 '인증 메일 다시 받기'가 그 이메일의 코드 입력 단계를 열고, 1단계에도 코드만 넣는 길이 있다", () => {
    const login = code(LOGIN);
    assert.match(login, /navigate\('Signup', isEmailLike\(ident\) \? \{ verifyEmail: normalizeEmail\(ident\) \} : undefined\)/);
    const signup = code(SIGNUP);
    assert.match(signup, /useState<string \| undefined>\(route\.params\?\.verifyEmail\)/);
    assert.match(signup, /title="가입은 했고 메일로 받은 코드만 넣을게요"/);
    assert.match(signup, /setSentTo\(normalizeEmail\(email\)\)/);
    assert.match(code('src/navigation/routes.ts'), /Signup: \{ verifyEmail\?: string \} \| undefined;/);
  });

  test('회원가입 1단계: 받은 인증 메일 안내는 입력 칸보다 위, 앞서 보낸 가입에 막히면 그 메일함으로 돌아간다', () => {
    const raw = read(SIGNUP);
    const step1 = raw.slice(raw.indexOf('/* ---------- 1단계'));
    const notice = step1.indexOf('<Notice\n            icon="mail"');
    assert.ok(notice > 0, '받은 인증 메일 안내는 Notice(icon mail)다');
    assert.ok(notice < step1.indexOf('<Field'), '로그인에서 다시 받기로 와도 첫 화면에 보이게 입력 칸보다 위에 둔다');
    assert.match(step1, /\{pending \? \(\s*<Notice\s+icon="mail"[\s\S]*?label: '메일 확인하기'[\s\S]*?setSentTo\(pending\.to\)/);
    assert.doesNotMatch(raw, /이미 받은 인증 메일 보기/, '폼 아래 글자 링크로 두지 않는다');
    const src = code(SIGNUP);
    assert.match(src, /setFail\(signUpFailText\(r, nickname, promoting \? undefined : held\)\)/);
    assert.match(src, /if \(!promoting\) setHeld\(\{ email: r\.account\.email, nickname: r\.account\.nickname \}\)/);
    assert.match(src, /fail\.heldEmail\s*\?\s*\{\s*label: '보낸 메일 보기'/);
  });

  test("계정찾기 시트: 제목은 '비밀번호 재설정', Sheet scroll, 빈 메일함 문구, 서버 설정 이름은 화면에 없다", () => {
    const src = code(FIND);
    assert.match(src, /<Sheet visible=\{visible\} onClose=\{onClose\} title="비밀번호 재설정" scroll>/);
    assert.doesNotMatch(src, /<ScrollView/);
    assert.match(src, /메일로 온 코드를 위 칸에 붙여 넣어 주세요\./);
    assert.match(src, /<CodeEntry label="메일로 받은 재설정 코드"/);
    assert.doesNotMatch(src, /AUTH_DEV_OUTBOX/);
    assert.doesNotMatch(src, /링크 끝|token\.slice/);
    // 설명은 코드 주석으로 옮겼다
    assert.match(read(FIND), /AUTH_DEV_OUTBOX/);
  });

  test("진입 화면의 화면 문구는 '~요' 톤이다(습니다·입니다 없음)", () => {
    for (const f of [ONBOARDING, INVITE, LOGIN, SIGNUP, SOCIAL, FIND]) {
      const strings = code(f).match(/'[^'\n]*'|`[^`]*`|"[^"\n]*"|>[^<>{}\n]+</g) ?? [];
      const bad = strings.filter((s) => /[가-힣](습|입)니다/.test(s));
      assert.deepEqual(bad, [], f);
    }
  });
});
