import type { Session, Trip } from '../../types';
import { planAccountDeletion, planAccountLink } from '../../core/auth';
import type { AccountPublic, AuthAck, AuthResult, OAuthCodeInput, OAuthProviderKind, OAuthStateResult, Profile } from '../../core/ports';
import { sessionExpiryNotice } from '../../core/session';
import { appClock } from '../../services/clock';
import type { SocialInput } from '../../services/auth';
import { getServices } from '../../services/registry';
import { clearSessionPhotos } from '../journal/api';
import { registerAccountDeletion, useSession, type DeleteAccountResult } from '../../store/session';
import { useTrips } from '../../store/trips';
import { useUi } from '../../store/ui';
import { promotionProfilePatch } from './profile';
import { judgeSocial, type SocialIntent, type SocialJudgement } from './social';

/**
 * 계정 흐름(WP1 소유). 인증 제공자(registry.auth)와 세션·여행방 스토어를 잇는다.
 * - 가입(16): 게스트 세션이 있으면 그 userId로 가입한다. 인증을 마치면 승격(userId 유지 + member/accountLinked).
 * - 로그인(15)·소셜(26): 성공하면 applyAuth. 같은 계정 userId의 여행방이 이 기기에 있으면 그대로 이어 쓴다.
 * - 승격 때는 게스트 때 고른 성향 태그와 이미지 정보를 계정에 먼저 올린다(이 기기 데이터 유지).
 * - 소셜 연결(17 → 26, intent 'link'): 지금 계정에만 붙이고 세션을 바꾸지 않는다(judgeSocial).
 * - 로그아웃·탈퇴는 signOutFlow로 세션·프로필과 지금 여행방(ui.currentTripId), 세션 사진 원본을 같이 비운다.
 *   계정 서버를 쓰면 서버 세션도 끊는다(AuthProvider.signOut. 기다리지 않고, 실패해도 이 기기는 로그아웃한다).
 * - 앱 시작 때 계정 세션이 서버에서 끊겼으면(만료·재설정·탈퇴) 로그아웃하고 다시 로그인하라고 알린다(restoreAccountSession).
 * - 비밀번호 재설정(requestPasswordResetFlow, confirmPasswordResetFlow): 15 로그인의 '계정찾기' 시트(FindAccountSheet)가 쓴다.
 * - 실제 소셜 로그인(oauthStateFlow, oauthSignInFlow): 계정 서버가 있을 때만. 결과는 소셜과 같은 판정(judgeSocial)이다.
 * - 탈퇴(17): planAccountDeletion 초안을 방마다 본인 멤버 이름으로 보내고(actingAs를 따르지 않는다),
 *   AuthProvider.deleteAccount 뒤 로그아웃한다.
 */

function allDocs(): Trip[] {
  return Object.values(useTrips.getState().docs);
}

export type LinkReport = { linked: number; failed: string[] };

/** 참여 중인 모든 방에 member/accountLinked를 보낸다. userId는 그대로라 데이터는 옮기지 않는다. */
export function linkAccountToTrips(userId: string): LinkReport {
  const report: LinkReport = { linked: 0, failed: [] };
  for (const p of planAccountLink(allDocs(), userId)) {
    const r = useTrips.getState().dispatchMany(p.tripId, p.drafts, { actorId: p.actorId });
    if (r.ok) report.linked += 1;
    else report.failed.push(`${useTrips.getState().docs[p.tripId]?.title ?? p.tripId}: ${r.reason}`);
  }
  return report;
}

/**
 * 로그인·승격 성공 뒤 공통 처리. 게스트였고 userId가 같으면 승격으로 보고 여행방에 연결한다.
 * 사람이 바뀌면(userId가 다르면) 지금 여행방 선택을 비운다. 이전 사람의 방 제목과 진입점이 남지 않게.
 */
export async function completeAuth(account: AccountPublic): Promise<{ promoted: boolean; report?: LinkReport }> {
  const st = useSession.getState();
  const before = st.session;
  const promoted = before?.kind === 'guest' && before.userId === account.userId;
  let acc = account;
  if (promoted) {
    const patch = promotionProfilePatch(st.profile, account.profile);
    if (patch) {
      const r = await getServices().auth.updateProfile(account.accountId, patch);
      // 제공자 저장에 실패해도 이 기기에서는 로컬 값을 유지한다(다음 저장 때 다시 올라간다).
      acc = r.ok ? r.account : { ...account, profile: { ...account.profile, ...patch } };
    }
  }
  if (before?.userId !== acc.userId) useUi.getState().setCurrentTrip(undefined);
  useSession.getState().applyAuth(acc);
  if (!promoted) return { promoted: false };
  return { promoted: true, report: linkAccountToTrips(acc.userId) };
}

/** 로그아웃. 세션·프로필(스토어)과 지금 여행방 선택을 비운다. 여행방 자체는 이 기기에 남는다. */
export function signOutFlow(): void {
  const s = useSession.getState().session;
  const auth = getServices().auth;
  if (s?.kind === 'account' && auth.signOut) void auth.signOut(s.accountId).catch(() => undefined);
  useSession.getState().signOut();
  useUi.getState().setCurrentTrip(undefined);
  // 이 세션에서만 보이던 웹 사진 원본(blob:)도 다음 사람에게 남기지 않는다.
  clearSessionPhotos();
}

/** 16 가입. 게스트면 그 userId를 계정에 물려 승격 준비를 한다. */
export async function signUpFlow(input: { email: string; password: string; nickname: string }): Promise<AuthResult> {
  const s = useSession.getState().session;
  if (s?.kind !== 'guest') return getServices().auth.signUp(input);
  // 게스트 userId는 여행방 로그로 남에게 보이므로, 이 기기 토큰을 같이 보내 같은 게스트인지 확인받는다
  return getServices().auth.signUp({ ...input, userId: s.userId, deviceToken: useSession.getState().ensureDeviceToken() });
}

/** 모의 메일함에서 인증. 인증되면 이 기기에서 바로 로그인(게스트면 승격)한다. */
export async function verifyFlow(token: string): Promise<{ result: AuthResult; promoted: boolean; report?: LinkReport }> {
  const result = await getServices().auth.verifyEmail(token);
  if (!result.ok) return { result, promoted: false };
  const cur = useSession.getState().session;
  // 다른 계정으로 로그인 중이면 세션을 바꾸지 않는다.
  if (cur?.kind === 'account' && cur.accountId !== result.account.accountId) return { result, promoted: false };
  const r = await completeAuth(result.account);
  return { result, ...r };
}

/** 15 이메일 로그인. 기기 토큰은 이 기기 것을 쓴다(시도 제한 기준). */
export async function signInFlow(input: { email: string; password: string }): Promise<AuthResult & { promoted?: boolean }> {
  const deviceToken = useSession.getState().ensureDeviceToken();
  const result = await getServices().auth.signIn({ ...input, deviceToken });
  if (!result.ok) return result;
  const r = await completeAuth(result.account);
  return { ...result, promoted: r.promoted };
}

export type SocialFlowResult = SocialJudgement & { account?: AccountPublic };

/**
 * 26 모의 소셜 동의 뒤.
 * - login: 성공이면 로그인한다. 같은 이메일이면 providerEmail(모의 제공자가 돌려준 이메일) 계정으로 linkRequired가 오고,
 *   화면이 확인을 받아 confirmLinkFlow를 부른다(자동 병합 없음).
 * - link: 지금 계정(linkToAccountId)에만 붙인다. 결과 계정이 지금 계정과 다르면 세션을 바꾸지 않고 실패로 돌려준다.
 */
export async function socialFlow(
  provider: 'kakao' | 'google',
  scenario: 'ok' | 'fail' | 'sameEmail',
  opts: { intent?: SocialIntent; providerEmail?: string } = {},
): Promise<SocialFlowResult> {
  const intent = opts.intent ?? 'login';
  const s = useSession.getState().session;
  const currentAccountId = s?.kind === 'account' ? s.accountId : undefined;
  if (intent === 'link' && !currentAccountId) {
    return { kind: 'fail', result: { ok: false, code: 'notFound', detail: '계정으로 로그인한 뒤에 연결할 수 있습니다' } };
  }
  const input: SocialInput = {
    provider,
    deviceToken: useSession.getState().ensureDeviceToken(),
    scenario,
    ...(intent === 'link' ? { linkToAccountId: currentAccountId } : {}),
    ...(scenario === 'sameEmail' && opts.providerEmail != null ? { providerEmail: opts.providerEmail } : {}),
  };
  const result = await getServices().auth.social(input);
  const j = judgeSocial(intent, result, currentAccountId);
  if (j.kind === 'signIn' && result.ok) await completeAuth(result.account);
  return { ...j, account: result.ok ? result.account : undefined };
}

const NO_OAUTH = '실제 소셜 로그인은 계정 서버가 있어야 합니다';

/** 실제 소셜 로그인 시작용 일회용 state(계정 서버). 서버에 키가 없으면 unconfigured */
export async function oauthStateFlow(provider: OAuthProviderKind, redirectUri: string): Promise<OAuthStateResult> {
  const auth = getServices().auth;
  if (!auth.oauthState) return { ok: false, code: 'providerFailed', detail: NO_OAUTH };
  return auth.oauthState({ provider, redirectUri });
}

/**
 * 실제 소셜 로그인 마무리. 인가 코드를 계정 서버로 넘기고 소셜과 같은 규칙으로 판정한다
 * (성공이면 로그인, 같은 이메일이면 연결 확인 단계, 아니면 실패). 기기 토큰은 이 기기 것이다.
 */
export async function oauthSignInFlow(input: Omit<OAuthCodeInput, 'deviceToken'>): Promise<SocialFlowResult> {
  const auth = getServices().auth;
  if (!auth.oauthSignIn) return { kind: 'fail', result: { ok: false, code: 'providerFailed', detail: NO_OAUTH } };
  const result = await auth.oauthSignIn({ ...input, deviceToken: useSession.getState().ensureDeviceToken() });
  const j = judgeSocial('login', result);
  if (j.kind === 'signIn' && result.ok) await completeAuth(result.account);
  return { ...j, account: result.ok ? result.account : undefined };
}

export async function confirmLinkFlow(linkToken: string, accept: boolean): Promise<AuthResult> {
  const result = await getServices().auth.confirmLink({ linkToken, accept });
  if (result.ok) await completeAuth(result.account);
  return result;
}

/**
 * 17 프로필 저장. 닉네임 중복을 거부한다. 계정이면 인증 제공자에도 저장하고, 게스트는 이 기기에만 둔다.
 * 게스트 닉네임도 계정 닉네임과 겹치면 거부한다(승격 때 충돌하지 않게).
 */
export async function saveProfileFlow(patch: Partial<Profile>): Promise<{ ok: true } | { ok: false; reason: string }> {
  const s = useSession.getState();
  const auth = getServices().auth;
  const nickname = patch.nickname?.trim();
  if (nickname != null && nickname !== s.profile.nickname) {
    if (await auth.isNicknameTaken(nickname, s.session?.accountId)) {
      return { ok: false, reason: '이미 쓰는 닉네임입니다' };
    }
  }
  const next = { ...patch, ...(nickname != null ? { nickname } : {}) };
  if (s.session?.kind === 'account' && s.session.accountId) {
    const r = await auth.updateProfile(s.session.accountId, next);
    if (!r.ok) return { ok: false, reason: r.detail ?? '프로필을 저장하지 못했습니다' };
  }
  useSession.getState().setProfile(next);
  if (nickname != null && s.session) {
    useSession.setState({ session: { ...s.session, nickname } });
  }
  return { ok: true };
}

/** 계정 탈퇴(비기능 데이터 보존). 초안 적용 → 계정 삭제 → 로그아웃 */
export async function deleteAccountFlow(): Promise<DeleteAccountResult> {
  const s = useSession.getState().session;
  if (!s || s.kind !== 'account' || !s.accountId) return { ok: false, reason: '게스트는 탈퇴할 계정이 없습니다' };
  const failed: string[] = [];
  for (const p of planAccountDeletion(allDocs(), s.userId)) {
    const r = useTrips.getState().dispatchMany(p.tripId, p.drafts, { actorId: p.actorId });
    if (!r.ok) failed.push(`${useTrips.getState().docs[p.tripId]?.title ?? p.tripId}: ${r.reason}`);
  }
  if (failed.length > 0) {
    // 계정은 지우지 않는다. 다시 누르면 남은 방만 처리한다(이미 익명 처리된 멤버·지운 사진은 초안에서 빠진다).
    return { ok: false, reason: `일부 여행방을 처리하지 못해 탈퇴를 멈췄습니다. ${failed.join(' / ')}` };
  }
  const r = await getServices().auth.deleteAccount(s.accountId);
  if (!r.ok && r.code !== 'notFound') return { ok: false, reason: '계정을 지우지 못했습니다. 다시 시도해 주세요' };
  signOutFlow();
  return { ok: true };
}

registerAccountDeletion(deleteAccountFlow);

/**
 * 앱 시작 때 계정 세션 확인. 계정 서버가 세션을 모르면(expired) 로그아웃하고 true를 돌려준다(부팅이 만료 안내를 낸다).
 * 서버에 닿지 못했거나 모의 인증이면 이 기기 세션을 그대로 둔다.
 */
export async function restoreAccountSession(): Promise<'ok' | 'expired' | 'unreachable' | 'skipped'> {
  const s = useSession.getState().session;
  const auth = getServices().auth;
  if (s?.kind !== 'account' || !s.accountId || !auth.checkSession) return 'skipped';
  const r = await auth.checkSession(s.accountId);
  if (r === 'expired') signOutFlow();
  return r;
}

const NO_RESET: AuthAck = { ok: false, code: 'notFound', detail: '이 인증 방식은 비밀번호 재설정을 지원하지 않습니다' };

/** 비밀번호 재설정 메일 요청. 가입 여부와 상관없이 같은 응답이다 */
export async function requestPasswordResetFlow(email: string): Promise<AuthAck> {
  const auth = getServices().auth;
  return auth.requestPasswordReset ? auth.requestPasswordReset(email) : NO_RESET;
}

/** 재설정 메일 토큰으로 새 비밀번호. 성공해도 로그인하지 않는다(새 비밀번호로 로그인한다) */
export async function confirmPasswordResetFlow(token: string, password: string): Promise<AuthAck & { violations?: string[] }> {
  const auth = getServices().auth;
  return auth.confirmPasswordReset ? auth.confirmPasswordReset({ token, password }) : NO_RESET;
}

/**
 * sessionExpiry 알림(만료 3일 전, 가정). 띄울 문구를 돌려주고 기록한다. 없으면 null.
 * extended는 부팅 때 연장 전 세션으로 판정한 경우다.
 */
export function takeSessionExpiryNotice(opts: { extended?: boolean; session?: Session } = {}): string | null {
  const st = useSession.getState();
  const session = opts.session ?? st.session;
  const now = appClock().now();
  const n = sessionExpiryNotice(session, now, st.notifyLog, st.notifyPrefs, {
    extended: opts.extended,
    notifiedKey: st.expiryNotifiedKey,
  });
  if (!n) return null;
  st.noteNotified(n.entry);
  return n.text;
}
