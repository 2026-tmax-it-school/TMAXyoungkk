import type { LocationPermission, LocationProvider } from '../../core/ports';

/**
 * 앱 안에서 먼저 묻는 위치 사용 동의(WP5 소유, 2026-10-17 사용자 요청: 위치를 쓸 건지 묻는 화면).
 * 기기 위치 제공자를 감싸, 앱 동의가 없으면 permission()은 'undetermined'를 돌려주고 request()는 먼저 앱 대화상자를 띄운다.
 * 허용하면 그다음에 기기(OS·브라우저) 권한을 묻는다. 기기에서 이미 거부했으면 앱 대화상자 없이 거부로 둔다.
 * - 동의를 묻고 기억하는 쪽(관문, gate)은 features/live/locationConsent가 등록한다. 등록 전(테스트 등)에는 그대로 통과한다.
 * - 시뮬레이터 위치(sim.ts)는 감싸지 않는다(실제 위치가 아니다).
 */

export type LocationConsentChoice = 'once' | 'whileUsing' | 'deny';

export interface LocationConsentGate {
  /** 이미 동의했는지('한 번 허용'은 앱을 끌 때까지, '앱을 사용하는 동안 허용'은 저장) */
  granted(): Promise<boolean>;
  /** 앱 대화상자를 띄우고 고른 답을 돌려준다 */
  ask(): Promise<LocationConsentChoice>;
}

let gate: LocationConsentGate | undefined;
/** 마지막 request가 앱 대화상자의 '허용 안 함'으로 끝났는지(기기 거부와 안내를 나눈다) */
let declined = false;

export function consentDeclined(): boolean {
  return declined;
}

export function setLocationConsentGate(next: LocationConsentGate | undefined): void {
  gate = next;
}

export function withLocationConsent(provider: LocationProvider): LocationProvider {
  return {
    id: provider.id,
    async permission(): Promise<LocationPermission> {
      const os = await provider.permission();
      if (!gate || os === 'denied') return os;
      return (await gate.granted()) ? os : 'undetermined';
    },
    async request() {
      declined = false;
      if (gate && !(await gate.granted())) {
        const choice = await gate.ask();
        if (choice === 'deny') {
          declined = true;
          return 'denied';
        }
      }
      return provider.request();
    },
    watch: (onSample, opts) => provider.watch(onSample, opts),
  };
}
