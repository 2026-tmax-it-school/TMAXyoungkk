import { KAKAO_MAP_JS_KEY } from '../../config';
import { KAKAO_LOAD_TIMEOUT_MS, kakaoScriptUrl } from './kakaoScript';

/**
 * 카카오맵 JavaScript SDK를 웹 문서에 한 번만 싣는다. 지도(KakaoMapView.web)와 장소 검색(services/kakaoSdk)이 같이 쓴다.
 * 둘이 따로 스크립트를 붙이면 SDK가 두 번 실리므로 여기 한 곳에서만 붙인다. 웹에서만 부른다(window·document).
 */

export class LoadError extends Error {
  readonly reason: 'auth' | 'script';
  constructor(reason: 'auth' | 'script') {
    super(reason === 'auth' ? '카카오 지도 키가 거부됐어요' : '카카오 지도 스크립트를 받지 못했어요');
    this.reason = reason;
  }
}

type KakaoWindow = Window & { kakao?: { maps?: { load(cb: () => void): void } } };

let loader: Promise<unknown> | undefined;

/** SDK를 한 번만 받는다. 실패하면 다음 호출이 다시 시도할 수 있게 비운다. 돌려받은 값은 window.kakao.maps다 */
export function loadKakaoSdk<T>(): Promise<T> {
  if (loader) return loader as Promise<T>;
  loader = new Promise<unknown>((resolve, reject) => {
    const win = window as KakaoWindow;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    const afterScript = () => {
      const maps = win.kakao?.maps;
      if (!maps || typeof maps.load !== 'function') {
        done(() => reject(new LoadError('script')));
        return;
      }
      // 앱 키가 거부되거나 이 도메인이 등록되지 않았으면 load 콜백이 오지 않는다
      timer = setTimeout(() => reject(new LoadError('auth')), KAKAO_LOAD_TIMEOUT_MS);
      maps.load(() => done(() => resolve(maps)));
    };
    if (win.kakao?.maps) {
      afterScript();
      return;
    }
    const s = document.createElement('script');
    s.src = kakaoScriptUrl(KAKAO_MAP_JS_KEY);
    s.async = true;
    s.onload = afterScript;
    s.onerror = () => {
      s.remove();
      reject(new LoadError('script'));
    };
    document.head.appendChild(s);
  }).catch((e: unknown) => {
    loader = undefined;
    throw e;
  });
  return loader as Promise<T>;
}
