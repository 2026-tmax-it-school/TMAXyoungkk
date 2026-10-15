import { KakaoHttpError, type KakaoClient } from './kakaoHttp';
import { KAKAO_CATEGORY_URL, KAKAO_KEYWORD_URL } from './places/kakao';
import { KAKAO_ADDRESS_URL, KAKAO_REGION_CODE_URL } from './regions';

/**
 * 카카오맵 JavaScript SDK services 라이브러리로 도는 카카오 클라이언트(웹 한정, 2026-10-15).
 * kakaoHttp와 같은 모양(get(카카오 REST 주소, 매개변수) → {documents})이라 places/kakao·regions가 그대로 쓴다.
 * 지도와 같은 JavaScript 키로 부르므로 카카오 콘솔 Web 도메인에 등록한 주소에서만 된다.
 * 카카오 앱의 REST 키가 막혀 있어도(403 disabled OPEN_MAP_AND_LOCAL) 지도 키가 되는 앱이면 검색이 된다.
 *
 * SDK 문서(apis.map.kakao.com/web/documentation/#services):
 * - Places.keywordSearch(keyword, cb, {x, y, radius, sort, size, page})
 * - Places.categorySearch(code, cb, {x, y, radius, sort, size, page})
 * - Geocoder.addressSearch(query, cb, {size, page})
 * - Geocoder.coord2RegionCode(x, y, cb)
 * - cb(data, status, pagination). status는 'OK' | 'ZERO_RESULT' | 'ERROR', data는 REST documents와 같은 배열이다
 * 길찾기(카카오모빌리티)와 POST는 SDK에 없다. 던지면 부르는 쪽이 대체로 넘어간다.
 */

type Cb = (data: unknown[], status: string) => void;
export interface KakaoServices {
  Places: new () => {
    keywordSearch(q: string, cb: Cb, o?: Record<string, unknown>): void;
    categorySearch(code: string, cb: Cb, o?: Record<string, unknown>): void;
  };
  Geocoder: new () => {
    addressSearch(q: string, cb: Cb, o?: Record<string, unknown>): void;
    coord2RegionCode(x: number, y: number, cb: Cb): void;
  };
}

/** SDK를 싣고 kakao.maps를 돌려준다(웹은 components/map/kakaoLoader). services가 없으면 던진다 */
export type KakaoSdkLoader = () => Promise<{ services?: KakaoServices }>;

/** 매개변수 중 SDK 옵션으로 넘길 것만 남긴다(undefined 제외, 숫자 매개변수는 숫자로) */
function options(params: Record<string, string | number | undefined>, keys: string[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of keys) {
    const v = params[k];
    if (v === undefined) continue;
    o[k] = k === 'sort' ? v : Number(v);
  }
  return o;
}

export function createKakaoSdkClient(opts: { load: KakaoSdkLoader }): KakaoClient {
  let last = '';

  async function services(): Promise<KakaoServices> {
    let maps: { services?: KakaoServices };
    try {
      maps = await opts.load();
    } catch (e) {
      last = 'SDK를 싣지 못함';
      throw new KakaoHttpError(`카카오 SDK를 싣지 못함: ${String(e)}`, 0, 'sdk');
    }
    if (!maps.services) {
      last = 'services 라이브러리 없음';
      throw new KakaoHttpError('카카오 SDK services 라이브러리 없음', 0, 'sdk');
    }
    return maps.services;
  }

  /** SDK 콜백을 REST 응답 모양({documents})으로 바꾼다. 결과 없음은 빈 목록, 오류는 던진다 */
  function call(run: (cb: Cb) => void): Promise<unknown> {
    return new Promise((resolve, reject) => {
      run((data, status) => {
        if (status === 'OK' || status === 'ZERO_RESULT') {
          last = '';
          resolve({ documents: status === 'OK' && Array.isArray(data) ? data : [] });
          return;
        }
        last = `SDK ${status}`;
        reject(new KakaoHttpError(`카카오 SDK 검색 실패(${status})`, 0, 'sdk'));
      });
    });
  }

  return {
    viaServer: false,
    async post() {
      throw new KakaoHttpError('카카오 SDK는 POST를 하지 않는다', 0, 'sdk');
    },
    async get(url, params) {
      const s = await services();
      switch (url) {
        case KAKAO_KEYWORD_URL: {
          const places = new s.Places();
          const o = options(params, ['x', 'y', 'radius', 'sort', 'size', 'page']);
          return call((cb) => places.keywordSearch(String(params.query ?? ''), cb, o));
        }
        case KAKAO_CATEGORY_URL: {
          const places = new s.Places();
          const o = options(params, ['x', 'y', 'radius', 'sort', 'size', 'page']);
          return call((cb) => places.categorySearch(String(params.category_group_code ?? ''), cb, o));
        }
        case KAKAO_ADDRESS_URL: {
          const geo = new s.Geocoder();
          const o = options(params, ['size', 'page']);
          return call((cb) => geo.addressSearch(String(params.query ?? ''), cb, o));
        }
        case KAKAO_REGION_CODE_URL: {
          const geo = new s.Geocoder();
          return call((cb) => geo.coord2RegionCode(Number(params.x), Number(params.y), cb));
        }
        default:
          throw new KakaoHttpError(`카카오 SDK가 맡지 않는 주소: ${url}`, 0, 'sdk');
      }
    },
    lastError: () => last,
  };
}
