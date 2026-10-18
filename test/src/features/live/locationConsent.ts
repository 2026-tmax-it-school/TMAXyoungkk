import { create } from 'zustand';

import { getServices } from '../../services/registry';
import { setLocationConsentGate, type LocationConsentChoice } from '../../services/location/consent';

/**
 * 위치 사용 동의 상태(WP5 소유, 2026-10-17 사용자 요청). 앱이 처음 위치를 쓰려 할 때(지도 '내 위치', 길찾기 '내 위치',
 * 여행 진행 '기기 위치로 진행') services/location/consent가 이 관문을 불러 대화상자(LocationConsentDialog)를 띄운다.
 * - 한 번 허용: 앱을 끌 때까지만 기억한다. 다음에 켜면 다시 묻는다.
 * - 앱을 사용하는 동안 허용: 기기 저장소(KV)에 남겨 다시 묻지 않는다.
 * - 허용 안 함: 이번 요청만 거절한다. 다음에 사용자가 다시 위치를 쓰려 하면 또 묻는다(누를 때만 묻는다).
 * 여러 곳이 동시에 물으면 대화상자는 하나만 뜨고 같은 답을 모두에게 준다.
 */

const KV_KEY = 'location.consent';

type Granted = 'none' | 'once' | 'whileUsing';

interface ConsentState {
  open: boolean;
  granted: Granted;
  answer: (choice: LocationConsentChoice) => void;
}

let waiters: ((c: LocationConsentChoice) => void)[] = [];
let loaded: Promise<void> | undefined;

export const useLocationConsent = create<ConsentState>((set, get) => ({
  open: false,
  granted: 'none',
  answer: (choice) => {
    const next: Granted = choice === 'whileUsing' ? 'whileUsing' : choice === 'once' && get().granted === 'none' ? 'once' : get().granted;
    set({ open: false, granted: next });
    if (choice === 'whileUsing') void getServices().kv.set(KV_KEY, 'whileUsing').catch(() => undefined);
    const list = waiters;
    waiters = [];
    for (const w of list) w(choice);
  },
}));

function load(): Promise<void> {
  loaded ??= getServices()
    .kv.get(KV_KEY)
    .then((v) => {
      if (v === 'whileUsing' && useLocationConsent.getState().granted === 'none') useLocationConsent.setState({ granted: 'whileUsing' });
    })
    .catch(() => undefined);
  return loaded;
}

setLocationConsentGate({
  async granted() {
    await load();
    return useLocationConsent.getState().granted !== 'none';
  },
  ask() {
    return new Promise<LocationConsentChoice>((resolve) => {
      waiters.push(resolve);
      useLocationConsent.setState({ open: true });
    });
  },
});
