/**
 * oauth.mjs의 타입 선언(WP2 소유). 테스트가 '../server/oauth.mjs'를 확장자까지 적어 import할 때 쓴다.
 */

export const GOOGLE_TOKEN_URL: string;
export const GOOGLE_TOKENINFO_URL: string;
export const KAKAO_TOKEN_URL: string;
export const KAKAO_ME_URL: string;
export const DEFAULT_REDIRECT_URIS: string[];

export type OAuthProvider = 'google' | 'kakao';

export class OAuthError extends Error {
  constructor(kind: 'exchange' | 'identity' | 'config', status?: number);
  kind: 'exchange' | 'identity' | 'config';
  status: number | null;
}

export type OAuthFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface OAuthClientOptions {
  google?: { clientId?: string; clientSecret?: string; nativeClientIds?: string[] };
  kakao?: { clientId?: string; clientSecret?: string };
  /** 허용하는 돌아올 주소(끝 '/' 무시 정확 일치). 기본 http://localhost:8090 */
  redirectUris?: string[];
  fetch?: OAuthFetch;
  now?: () => number;
  timeoutMs?: number;
}

export interface OAuthIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  nickname: string;
}

export interface OAuthClient {
  readonly redirectUris: string[];
  configured(provider: OAuthProvider): boolean;
  redirectAllowed(uri: string): boolean;
  exchange(provider: OAuthProvider, input: { code: string; codeVerifier?: string; redirectUri: string; clientId?: string }): Promise<OAuthIdentity>;
}

export function normalizeRedirectUri(uri: unknown): string;
export function oauthOptionsFromEnv(env: Record<string, string | undefined>): Required<Pick<OAuthClientOptions, 'redirectUris'>> & {
  google: { clientId: string; clientSecret: string; nativeClientIds: string[] };
  kakao: { clientId: string; clientSecret: string };
};
export function describeOAuth(opts: OAuthClientOptions): string;
export function createOAuthClient(opts?: OAuthClientOptions): OAuthClient;
