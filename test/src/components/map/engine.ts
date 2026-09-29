import { GOOGLE_MAPS_API_KEY, MAP_PROVIDER } from '../../config';
import { pickMapEngine } from '../../core/map/engine';

/** 이번 번들의 지도 엔진. 키와 EXPO_PUBLIC_MAP_PROVIDER로 한 번 정한다(core/map/engine 규칙). */
export const MAP_ENGINE = pickMapEngine({ key: GOOGLE_MAPS_API_KEY, override: MAP_PROVIDER });
