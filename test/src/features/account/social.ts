import type { AuthResult } from '../../core/ports';

/**
 * 26 모의 소셜 결과 판정(FR-103, WP1 소유, 순수). flows.socialFlow가 부르고 wp1-auth가 node로 검사한다.
 * - login: 성공이면 그 계정으로 로그인(applyAuth)한다. linkRequired는 화면이 확인을 받는다(자동 병합 없음).
 * - link(17 '카카오 연결'): 지금 계정에 로그인 방법만 붙인다. 결과 계정이 지금 계정과 다르면 세션을 바꾸지 않고 거부한다.
 *   계약만 따르는 제공자가 linkToAccountId를 모르고 새 계정을 돌려줘도 로그인한 사람이 조용히 바뀌지 않게 하려는 것이다.
 */

export type SocialIntent = 'login' | 'link';

export type SocialJudgement =
  | { kind: 'signIn' }
  | { kind: 'linked' }
  | { kind: 'confirm'; linkToken: string; text: string }
  | { kind: 'fail'; result: Extract<AuthResult, { ok: false }> };

export const LINK_MISMATCH_TEXT = '다른 계정으로 바뀌는 결과라 연결을 멈췄습니다. 지금 계정은 그대로입니다.';

export function judgeSocial(intent: SocialIntent, result: AuthResult, currentAccountId?: string): SocialJudgement {
  if (!result.ok) {
    if (result.code === 'linkRequired' && result.linkToken) {
      // 연결 모드에서는 지금 계정에 바로 붙이므로 다른 계정 연동 확인으로 넘어가지 않는다.
      if (intent === 'link') return { kind: 'fail', result: { ...result, linkToken: undefined, detail: LINK_MISMATCH_TEXT } };
      return { kind: 'confirm', linkToken: result.linkToken, text: result.detail ?? '같은 이메일로 가입한 계정이 있습니다.' };
    }
    return { kind: 'fail', result };
  }
  if (intent === 'link') {
    if (!currentAccountId || result.account.accountId !== currentAccountId) {
      return { kind: 'fail', result: { ok: false, code: 'notFound', detail: LINK_MISMATCH_TEXT } };
    }
    return { kind: 'linked' };
  }
  return { kind: 'signIn' };
}
