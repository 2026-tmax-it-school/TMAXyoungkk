import type { Trip } from '../../types';
import { INVITE_BASE_URL } from '../../config';
import { inviteUrl, newInvite } from '../../core/trip/invite';
import { appClock } from '../../services/clock';
import { getServices } from '../../services/registry';
import { copyText, shareText, type ShareOutcome } from '../../services/share';
import { useTrips } from '../../store/trips';
import { useUi } from '../../store/ui';
import { issueAndShareWith, type IssueShareResult } from './inviteShare';

/**
 * 여행방 화면 공용 동작(WP2). 스토어와 서비스를 부르는 얇은 층이다. 판정은 core/trip에 있다.
 */

/** 새 초대 링크(FR-301). 난수는 registry의 보안 난수(expo-crypto)다. 재발급이면 이전 코드는 무효가 된다. */
export function issueInvite(tripId: string): boolean {
  const invite = newInvite(getServices().rng, appClock().now());
  return useTrips.getState().dispatch(tripId, { type: 'trip/issueInvite', invite }).ok;
}

function inviteMessage(trip: Trip, code: string): string {
  return `${trip.title} 여행방에 초대해요. 가입 없이 게스트로 들어올 수 있어요.\n${inviteUrl(code, INVITE_BASE_URL)}\n초대 코드 ${code}`;
}

/** 링크 공유. 공유 시트가 안 되는 브라우저에서는 복사로 대체하고 토스트로 알린다. */
export async function shareInvite(trip: Trip): Promise<ShareOutcome> {
  const code = trip.invite?.code;
  if (!code) return 'failed';
  const toast = useUi.getState().showToast;
  const r = await shareText({ title: `${trip.title} 초대`, text: inviteMessage(trip, code) });
  if (r === 'copied') toast('이 브라우저는 공유를 지원하지 않아 링크를 복사했어요');
  else if (r === 'failed') toast('공유와 복사를 하지 못했어요. 초대 코드를 직접 알려 주세요', 'warn');
  return r;
}

/**
 * 14 멤버 초대의 주 버튼(Foot). 쓸 수 있는 링크가 있으면 공유하고, 없거나 무효면 새로 만들어 공유한다.
 * 흐름은 순수 issueAndShareWith(inviteShare.ts, wp2-trip-ux 테스트)이고 여기서는 스토어와 공유 시트를 넣는다.
 */
export function issueAndShare(tripId: string): Promise<IssueShareResult> {
  return issueAndShareWith({
    getTrip: () => useTrips.getState().docs[tripId],
    issue: () => issueInvite(tripId),
    share: (trip) => shareInvite(trip),
    now: appClock().now(),
  });
}

/** 초대 코드만 복사(링크를 못 받는 사람에게 코드로 알려 줄 때, 초대 코드로 합류 화면에 붙여 넣는다) */
export async function copyInviteCode(trip: Trip): Promise<void> {
  const code = trip.invite?.code;
  if (!code) return;
  const toast = useUi.getState().showToast;
  const r = await copyText(code);
  toast(r === 'copied' ? '초대 코드를 복사했어요' : '복사하지 못했어요. 코드를 직접 알려 주세요', r === 'copied' ? 'soft' : 'warn');
}

/** 링크 복사(expo-clipboard) */
export async function copyInvite(trip: Trip): Promise<void> {
  const code = trip.invite?.code;
  if (!code) return;
  const toast = useUi.getState().showToast;
  const r = await copyText(inviteUrl(code, INVITE_BASE_URL));
  if (r === 'copied') toast('초대 링크를 복사했어요');
  else toast('복사하지 못했어요. 초대 코드를 직접 알려 주세요', 'warn');
}
