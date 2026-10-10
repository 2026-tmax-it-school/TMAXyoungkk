import * as Font from 'expo-font';

import { LEGACY_STORAGE_KEY } from '../../core/constants';
import { expiredNotice } from '../../core/session';
import { appClock } from '../../services/clock';
import { asyncStorageKV } from '../../services/kv';
import { useLive } from '../../store/live';
import { useSession } from '../../store/session';
import { useTrips } from '../../store/trips';
import { useUi } from '../../store/ui';
import { FONT_ASSETS, FONT_LABELS } from '../../ui/fonts';
import { restoreAccountSession, takeSessionExpiryNotice } from './flows';

/**
 * 부팅(WP1 소유). App.tsx는 이 함수만 부르고 그동안 01 스플래시를 그린다.
 * 1~4단계: 폰트 4개를 Font.loadAsync로 차례로 불러온다.
 * 5~8단계: 스토어 4개(ui, session, trips, live)의 복원을 기다린다.
 * 진행률은 단계 수(8단계) 기준이고 label은 지금 하는 단계 이름이다. 바이트 진행률은 약속하지 않는다.
 * 그다음 한 번에 끝나는 정리를 한다: 구 저장 키 삭제(안내는 한 번만), 만료 3일 전 알림(연장 전 세션 기준),
 * 세션 갱신(만료면 폐기와 안내), 계정 서버 세션 확인(끊겼으면 로그아웃과 같은 만료 안내), 보관 기한이 지난 여행방 로컬 삭제(purgeExpired, WP2).
 */

export interface BootProgress {
  done: number;
  total: number;
  label: string;
}

export interface BootResult {
  sessionState: 'ok' | 'expired' | 'none';
  notices: string[];
}

export async function bootstrap(onProgress: (p: BootProgress) => void): Promise<BootResult> {
  const notices: string[] = [];
  const fonts = Object.keys(FONT_ASSETS) as (keyof typeof FONT_ASSETS)[];
  const tripTitle = () => {
    const ui = useUi.getState();
    const t = ui.currentTripId ? useTrips.getState().docs[ui.currentTripId] : undefined;
    return t ? ` · ${t.title}` : '';
  };
  const steps: { label: () => string; run: () => Promise<void> }[] = [
    ...fonts.map((family) => ({
      label: () => `${FONT_LABELS[family]} 불러오는 중`,
      run: () => Font.loadAsync({ [family]: FONT_ASSETS[family] }),
    })),
    { label: () => '화면 설정 복원 중', run: () => useUi.getState().waitHydrated() },
    { label: () => '세션 복원 중', run: () => useSession.getState().waitHydrated() },
    { label: () => '여행방 불러오는 중', run: () => useTrips.getState().waitHydrated() },
    { label: () => `여행 기록 불러오는 중${tripTitle()}`, run: () => useLive.getState().waitHydrated() },
  ];
  const total = steps.length;

  for (let i = 0; i < total; i += 1) {
    const label = steps[i].label();
    onProgress({ done: i, total, label });
    try {
      await steps[i].run();
    } catch {
      notices.push(`${label.replace(/ 중$/, '')}에 실패했습니다. 기본 글꼴이나 빈 상태로 계속합니다.`);
    }
  }

  // 1단계 프로토타입 저장 키는 옮기지 않고 지운다(구 토큰이 추측 가능해서). 안내는 한 번만 한다.
  try {
    const raw = asyncStorageKV('');
    if ((await raw.get(LEGACY_STORAGE_KEY)) != null) {
      await raw.remove(LEGACY_STORAGE_KEY);
      if (!useSession.getState().legacyNoticeShown) {
        notices.push('이전 버전 데이터는 새 형식으로 옮기지 않고 지웠어요.');
        useSession.getState().markLegacyNoticeShown();
      }
    }
  } catch {
    // 저장소를 못 읽으면 다음 실행 때 다시 시도한다.
  }

  // 만료 3일 전 알림은 연장하기 전 세션으로 판정한다(쓰면 30일 연장되므로).
  const before = useSession.getState().session;
  const soon = before ? takeSessionExpiryNotice({ extended: true, session: before }) : null;

  let sessionState = useSession.getState().touchSession();
  if (sessionState === 'ok') {
    // 계정 서버가 세션을 모르면(만료·다른 기기 재설정·탈퇴) 다시 로그인하게 한다. 서버에 닿지 못하면 그대로 쓴다
    try {
      if ((await restoreAccountSession()) === 'expired') {
        sessionState = 'expired';
        useSession.setState({ expiredKind: 'account' });
      }
    } catch {
      // 확인을 못 하면 이 기기 세션을 그대로 쓴다
    }
  }
  if (sessionState === 'expired') {
    notices.push(expiredNotice({ kind: useSession.getState().expiredKind ?? 'guest' }));
  } else if (soon) {
    notices.push(soon);
  }

  try {
    useTrips.getState().purgeExpired(appClock().now());
  } catch {
    // 보관 기한 정리는 다음 부팅 때 다시 한다.
  }

  onProgress({ done: total, total, label: '준비 완료' });
  return { sessionState, notices };
}
