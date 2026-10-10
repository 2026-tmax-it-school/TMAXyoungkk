import type { OAuthProviderKind } from '../../core/ports';

/**
 * 실제 소셜 로그인(구글·카카오 OAuth) 순수 규칙(WP1 소유). 화면 훅(useOAuthLogin)이 쓰고 wp1-oauth가 node로 검사한다.
 * - 인가 코드 흐름 + PKCE. 앱은 제공자 로그인 창만 열고, 돌아온 코드는 계정 서버가 제공자와 바꾼다(client secret은 서버에만).
 * - state는 계정 서버가 준 일회용 값이다(POST /auth/oauth/state). expo-auth-session이 돌아온 state와 다시 맞춰 본다.
 * - 쓸 수 없을 때(계정 서버 없음, 앱 키 없음, 서버 키 없음)도 버튼은 보이고 누르면 이유를 알린다. 모의 동의 화면으로 이어 갈 수 있다.
 */

export const OAUTH_LABEL: Record<OAuthProviderKind, string> = { kakao: '카카오', google: '구글' };
/** 주격 조사까지 붙인 이름(카카오가, 구글이) */
const OAUTH_SUBJECT: Record<OAuthProviderKind, string> = { kakao: '카카오가', google: '구글이' };

/** 제공자 로그인 주소(expo-auth-session discovery). 인가 코드만 받으므로 authorizationEndpoint만 있으면 된다 */
export const OAUTH_DISCOVERY: Record<OAuthProviderKind, { authorizationEndpoint: string }> = {
  google: { authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth' },
  kakao: { authorizationEndpoint: 'https://kauth.kakao.com/oauth/authorize' },
};

/** 요청 범위. 카카오는 콘솔의 동의항목(닉네임·이메일)을 따르므로 비운다 */
export const OAUTH_SCOPES: Record<OAuthProviderKind, string[]> = {
  google: ['openid', 'email', 'profile'],
  kakao: [],
};

/** 제공자 로그인 창에 덧붙이는 값. 구글은 계정 고르기 창을 늘 띄운다 */
export const OAUTH_EXTRA_PARAMS: Record<OAuthProviderKind, Record<string, string>> = {
  google: { prompt: 'select_account' },
  kakao: {},
};

export type OAuthReadiness =
  | { kind: 'ready' }
  /** 계정 서버가 없다(이 기기 모의 인증). 실제 소셜 로그인은 서버가 코드를 바꿔야 한다 */
  | { kind: 'noServer'; text: string }
  /** 앱 .env에 그 제공자 클라이언트 ID가 없다 */
  | { kind: 'noClientId'; text: string };

/** 지금 실제 소셜 로그인을 시작할 수 있는지(서버 키 여부는 state를 받아 봐야 안다) */
export function oauthReadiness(input: {
  provider: OAuthProviderKind;
  authId: 'local' | 'server' | undefined;
  hasOAuth: boolean;
  clientId: string;
  platform: string;
}): OAuthReadiness {
  const label = OAUTH_LABEL[input.provider];
  if (input.authId !== 'server' || !input.hasOAuth) {
    return {
      kind: 'noServer',
      text: `실제 ${label} 로그인은 계정 서버가 있어야 합니다. 지금은 이 기기 모의 인증이라 시연용 동의 화면으로 계속할 수 있어요.`,
    };
  }
  if (!input.clientId) {
    const env =
      input.provider === 'kakao'
        ? 'EXPO_PUBLIC_KAKAO_OAUTH_CLIENT_ID'
        : input.platform === 'android'
          ? 'EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID'
          : input.platform === 'ios'
            ? 'EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID'
            : 'EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID';
    return {
      kind: 'noClientId',
      text: `${label} 로그인 키가 설정되지 않았습니다. 앱 .env의 ${env}에 키를 넣고 앱을 다시 띄워 주세요.`,
    };
  }
  return { kind: 'ready' };
}

/** 제공자 로그인 창 결과(expo-auth-session AuthSessionResult의 필요한 부분) */
export type PromptOutcome =
  | { type: 'cancel' | 'dismiss' | 'opened' | 'locked' }
  | { type: 'success' | 'error'; params: Record<string, string>; errorCode?: string | null; error?: { message?: string } | null };

export type PromptJudgement =
  | { kind: 'code'; code: string; state: string }
  | { kind: 'cancel' }
  | { kind: 'fail'; text: string };

/**
 * 로그인 창 결과 판정. 성공이면 인가 코드와 돌아온 state. 사용자가 닫았거나 거절했으면 cancel(아무 안내 없이 그대로 둔다).
 * expectedState와 다르면 실패다(expo-auth-session도 보지만 한 번 더 본다). 제공자 오류 문구는 그대로 보이지 않는다
 */
export function judgePrompt(provider: OAuthProviderKind, r: PromptOutcome, expectedState: string): PromptJudgement {
  const label = OAUTH_LABEL[provider];
  if (r.type !== 'success' && r.type !== 'error') return { kind: 'cancel' };
  const params = r.params ?? {};
  if (r.type === 'error' || params.error) {
    if (params.error === 'access_denied' || params.error === 'consent_required') return { kind: 'cancel' };
    return { kind: 'fail', text: `${label} 로그인 창에서 오류가 났습니다. 잠시 뒤 다시 시도해 주세요` };
  }
  const code = typeof params.code === 'string' ? params.code : '';
  if (!code) return { kind: 'fail', text: `${OAUTH_SUBJECT[provider]} 인가 코드를 돌려주지 않았습니다. 다시 시도해 주세요` };
  if (params.state !== expectedState) {
    return { kind: 'fail', text: '로그인 요청이 맞지 않습니다(다른 창에서 시작한 요청). 다시 시도해 주세요' };
  }
  return { kind: 'code', code, state: params.state };
}

/** state를 다시 받아야 하는지. 만료 1분 전부터 새로 받는다 */
export function stateNeedsRefresh(state: { expiresAt: number } | null, now: number): boolean {
  return state == null || state.expiresAt - now < 60_000;
}
