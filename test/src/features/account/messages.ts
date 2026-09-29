import type { AuthFail } from '../../core/ports';
import { kstHHMM } from '../../core/util';

/**
 * 인증 실패를 화면 문구로 바꾼다(WP1 소유, 순수). 오류는 앰버 Notice로 보인다.
 * 제공자가 준 detail이 있으면 그것을 본문으로 쓰고, 잠금·제한은 풀리는 시각을 덧붙인다.
 */

const TITLE: Record<AuthFail, string> = {
  duplicateEmail: '이미 가입한 이메일입니다',
  weakPassword: '비밀번호 규칙을 지켜 주세요',
  locked: '잠시 로그인할 수 없습니다',
  deviceLimited: '이 기기의 시도가 너무 많습니다',
  unverified: '이메일 인증이 필요합니다',
  badCredentials: '로그인하지 못했습니다',
  providerFailed: '소셜 로그인 응답이 없습니다',
  linkRequired: '계정 연결 확인이 필요합니다',
  nicknameTaken: '이미 쓰는 닉네임입니다',
  invalidToken: '쓸 수 없는 링크입니다',
  notFound: '계정을 찾지 못했습니다',
};

export function authFailText(fail: { code: AuthFail; detail?: string; retryAt?: number; violations?: string[] }): {
  title: string;
  text: string;
} {
  const parts: string[] = [];
  if (fail.detail) parts.push(fail.detail);
  if (fail.violations && fail.violations.length > 0) parts.push(`빠진 조건: ${fail.violations.join(', ')}`);
  if (fail.retryAt != null) parts.push(`${kstHHMM(fail.retryAt)}부터 다시 시도할 수 있습니다.`);
  return { title: TITLE[fail.code], text: parts.join(' ') || '잠시 뒤 다시 시도해 주세요.' };
}
