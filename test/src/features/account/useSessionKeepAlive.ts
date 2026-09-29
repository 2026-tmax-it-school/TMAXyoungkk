import { useEffect } from 'react';

import { useNow } from '../../services/clock';
import { useSession } from '../../store/session';
import { useUi } from '../../store/ui';

/**
 * 앱을 쓰는 동안 세션을 유지한다(FR-105·FR-102 '사용할 때마다 갱신', WP1 소유).
 * 홈은 탭이라 계속 마운트되어 있으므로 홈이 부른다. useNow가 30초 틱과 시뮬레이터 시각 변경을 따라 바뀔 때마다
 * keepAlive(core/session.keepSession)로 판정한다. 갱신은 앱 시각 1시간 간격이다.
 * - 만료: 세션을 폐기하고 안내 토스트(게스트는 복구 불가, 계정은 다시 로그인하면 여행방 유지). 루트가 온보딩으로 바뀐다.
 * - 연장 전 세션이 만료 3일 창 안이었으면 sessionExpiry 알림을 한 번 띄운다(30분 1회·끄기·세션 창마다 한 번).
 */
export function useSessionKeepAlive(): void {
  const now = useNow();
  useEffect(() => {
    const r = useSession.getState().keepAlive();
    if (r.state === 'expired') useUi.getState().showToast(r.text, 'warn');
    if (r.state === 'touched' && r.notice) useUi.getState().showToast(r.notice.text, 'warn');
  }, [now]);
}
