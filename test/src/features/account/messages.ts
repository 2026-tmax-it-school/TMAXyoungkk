import { sameNickname } from '../../core/auth';
import type { AuthFail } from '../../core/ports';
import { josa, kstHHMM } from '../../core/util';

/**
 * 인증 실패를 화면 문구로 바꾼다(WP1 소유, 순수). 오류는 앰버 Notice로 보인다.
 * 제공자가 준 detail이 있으면 그것을 본문으로 쓰고, 잠금·제한은 풀리는 시각을 덧붙인다.
 * 진입 화면이 같이 쓰는 안내 문구(게스트 한계, 지금 게스트라는 경고 제목)도 여기에 둔다. 문구는 '~요' 톤이다.
 */

const TITLE: Record<AuthFail, string> = {
  duplicateEmail: '이미 가입한 이메일이에요',
  weakPassword: '비밀번호 규칙을 지켜 주세요',
  locked: '잠시 로그인할 수 없어요',
  deviceLimited: '이 기기의 시도가 너무 많아요',
  unverified: '이메일 인증이 필요해요',
  badCredentials: '로그인하지 못했어요',
  providerFailed: '소셜 로그인 응답이 없어요',
  linkRequired: '계정 연결 확인이 필요해요',
  nicknameTaken: '이미 쓰는 닉네임이에요',
  invalidToken: '쓸 수 없는 링크예요',
  notFound: '계정을 찾지 못했어요',
};

export function authFailText(fail: { code: AuthFail; detail?: string; retryAt?: number; violations?: string[] }): {
  title: string;
  text: string;
} {
  const parts: string[] = [];
  if (fail.detail) parts.push(fail.detail);
  if (fail.violations && fail.violations.length > 0) parts.push(`빠진 조건: ${fail.violations.join(', ')}`);
  if (fail.retryAt != null) parts.push(`${kstHHMM(fail.retryAt)}부터 다시 시도할 수 있어요.`);
  return { title: TITLE[fail.code], text: parts.join(' ') || '잠시 뒤 다시 시도해 주세요.' };
}

/**
 * 회원가입 실패 문구. 세션 없이 보낸 가입은 인증 전에도 닉네임을 잡고 있고, 인증 제공자는 인증 전 가입을
 * 같은 게스트가 다시 낼 때만 대체한다. 그래서 '이메일 바꾸기' 뒤 같은 닉네임으로 다시 내면 nicknameTaken이 온다.
 * 그 경우(held: 이 화면에서 앞서 보낸 가입)에는 왜 막혔는지와 할 일을 알리고, 앞서 보낸 주소를 돌려줘
 * 그 메일함으로 돌아가는 동작을 붙이게 한다. 그 밖에는 authFailText와 같다.
 */
export function signUpFailText(
  fail: Parameters<typeof authFailText>[0],
  nickname: string,
  held?: { email: string; nickname: string },
): { title: string; text: string; heldEmail?: string } {
  if (fail.code === 'nicknameTaken' && held && sameNickname(nickname, held.nickname)) {
    return {
      title: '앞서 보낸 가입이 쓰는 닉네임이에요',
      text: `${held.email}로 보낸 가입이 인증 전이라 이 닉네임을 아직 쓸 수 없어요. 다른 닉네임으로 가입하거나 보낸 메일에서 인증해 주세요.`,
      heldEmail: held.email,
    };
  }
  return authFailText(fail);
}

/**
 * 게스트 한계 안내. 온보딩 닉네임 칸과 세션 없이 초대를 받는 이름 칸의 help로, 시작·합류 버튼보다 앞에 보인다.
 * 나중에 알면 일정을 다 짜고 잃는다.
 */
export const GUEST_LIMIT_HELP = '이 기기에서만 쓰는 게스트예요. 기기를 바꾸거나 30일 동안 안 쓰면 복구할 수 없어요.';

/** 로그인·소셜 동의의 게스트 경고 제목. 받침에 맞춰 '민지예요', '지훈이에요'로 쓴다 */
export function guestNowTitle(nickname: string): string {
  const name = nickname.trim();
  return `지금은 게스트 ${name}${josa(name, '이/가').endsWith('가') ? '예요' : '이에요'}`;
}
