import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import {
  acceptFix,
  LOCATE_ZOOM,
  locateFailText,
  locateNext,
  shouldRecenter,
  type LocateFail,
  type LocateFix,
  type LocateMode,
} from '../../core/map/locate';
import type { LatLng } from '../../types';
import { getServices } from '../../services/registry';
import { ONCE_TIMEOUT_MS } from '../../services/location/once';
import { useUi } from '../../store/ui';
import type { MapCenterRequest } from './parts';

/**
 * 지도 '내 위치' 버튼의 위치 공급(WP5 소유). 상태 규칙은 core/map/locate.ts(순수)다.
 * - GPS 감시는 사용자가 버튼을 눌렀을 때(onTap)만 켠다. 화면이 열릴 때 켜지 않는다.
 * - 끄는 때: 버튼으로 끔, 지도가 내려감(unmount), 화면이 가려짐(useIsFocused), 앱이 뒤로 감(AppState).
 * - 화면이 여행 진행 중 위치(live, 시뮬레이터 포함)를 주면 GPS를 켜지 않고 그 위치를 쓴다.
 * - 5m 안쪽 흔들림은 버리고, 따라가기 중 지도 이동은 1초에 한 번까지만 한다.
 * - 위치는 기기 안에서만 쓴다. 서버로 보내거나 저장하지 않는다.
 * 웹은 기존 위치 제공자(expo-location, navigator.geolocation)를 그대로 쓴다. 브라우저는 https와 localhost에서만 위치를 준다.
 */

export interface MyLocation {
  mode: LocateMode;
  /** 지도에 그릴 내 위치. 화면이 준 live 위치가 먼저다 */
  user?: LocateFix;
  center?: MapCenterRequest;
  onTap: () => void;
  onUserMove: () => void;
}

const IS_WEB = Platform.OS === 'web';

/** 웹 비보안 출처(http 원격 주소)에서는 브라우저가 위치를 주지 않는다 */
function webBlocked(): boolean {
  if (!IS_WEB || typeof window === 'undefined') return false;
  return window.isSecureContext === false || typeof navigator === 'undefined' || !navigator.geolocation;
}

export function useMyLocation(live: LocateFix | undefined): MyLocation {
  const [mode, dispatch] = useReducer(locateNext, 'off');
  const [fix, setFix] = useState<LocateFix | undefined>(undefined);
  const [center, setCenter] = useState<MapCenterRequest | undefined>(undefined);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const fixRef = useRef<LocateFix | undefined>(undefined);
  const liveRef = useRef(live);
  liveRef.current = live;
  /** 지금 켜져 있는 감시를 끄는 함수와 첫 위치 시한 */
  const stopRef = useRef<(() => void) | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** 권한 요청 중 취소되면 늦게 온 결과를 버린다 */
  const genRef = useRef(0);
  const seqRef = useRef(0);
  const lastCenter = useRef<{ coord: LatLng; at: number } | undefined>(undefined);
  /** 지금 위치를 어디서 받는가. live는 화면이 준 여행 진행 위치다 */
  const sourceRef = useRef<'gps' | 'live' | undefined>(undefined);

  const moveTo = useCallback((coord: LatLng, zoom?: number) => {
    seqRef.current += 1;
    lastCenter.current = { coord, at: Date.now() };
    setCenter({ coord, zoom, seq: seqRef.current });
  }, []);

  const stopWatch = useCallback(() => {
    genRef.current += 1;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    const stop = stopRef.current;
    stopRef.current = undefined;
    stop?.();
  }, []);

  const turnOff = useCallback(() => {
    stopWatch();
    sourceRef.current = undefined;
    fixRef.current = undefined;
    setFix(undefined);
    // 지난 이동 요청을 지운다. 남겨 두면 다시 켤 때 새 위치가 오기 전에 옛 자리로 지도가 뛴다
    setCenter(undefined);
    lastCenter.current = undefined;
    dispatch({ type: 'stop' });
  }, [stopWatch]);

  const fail = useCallback(
    (reason: LocateFail) => {
      stopWatch();
      sourceRef.current = undefined;
      fixRef.current = undefined;
      setFix(undefined);
      setCenter(undefined);
      lastCenter.current = undefined;
      dispatch({ type: 'fail', reason });
      useUi.getState().showToast(locateFailText(reason, IS_WEB), 'warn');
    },
    [stopWatch],
  );

  /** 위치 하나가 왔다(GPS든 live든). 처음이면 그 자리로 당기고, 따라가기면 조금씩 옮긴다 */
  const onFix = useCallback(
    (next: LocateFix) => {
      const m = modeRef.current;
      if (m === 'off') return;
      if (m === 'locating') {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
        fixRef.current = next;
        setFix(next);
        dispatch({ type: 'fix' });
        // 다시 그리기 전에 다음 위치가 와도 한 번만 당기게 바로 바꿔 둔다
        modeRef.current = 'centered';
        moveTo(next.coord, LOCATE_ZOOM);
        return;
      }
      if (!acceptFix(fixRef.current, next)) return;
      fixRef.current = next;
      setFix(next);
      if (m === 'follow' && shouldRecenter(lastCenter.current, next.coord, Date.now())) moveTo(next.coord);
    },
    [moveTo],
  );

  /** 버튼을 눌렀을 때만 감시를 켠다 */
  const startWatch = useCallback(async () => {
    if (webBlocked()) {
      fail('unavailable');
      return;
    }
    const gen = ++genRef.current;
    const provider = getServices().location;
    let perm = await provider.permission().catch(() => 'denied' as const);
    if (gen !== genRef.current) return;
    if (perm !== 'granted') perm = await provider.request().catch(() => 'denied' as const);
    if (gen !== genRef.current) return;
    if (perm !== 'granted') {
      fail('denied');
      return;
    }
    timerRef.current = setTimeout(() => fail('timeout'), ONCE_TIMEOUT_MS);
    try {
      const stop = provider.watch((s) => onFix({ coord: s.coord, accuracyM: s.accuracyM }), { intervalMs: 1000, adaptive: false });
      if (gen !== genRef.current) stop();
      else stopRef.current = stop;
    } catch {
      fail('unavailable');
    }
  }, [fail, onFix]);

  const onTap = useCallback(() => {
    const m = modeRef.current;
    const next = locateNext(m, { type: 'tap' });
    if (next === 'off') {
      turnOff();
      return;
    }
    dispatch({ type: 'tap' });
    if (m === 'off') {
      modeRef.current = 'locating';
      const l = liveRef.current;
      sourceRef.current = l ? 'live' : 'gps';
      if (l) onFix(l);
      else void startWatch();
      return;
    }
    // centered에서 따라가기로: 지금 자리로 바로 옮긴다(배율은 그대로)
    const at = liveRef.current ?? fixRef.current;
    if (next === 'follow' && at) moveTo(at.coord);
  }, [moveTo, onFix, startWatch, turnOff]);

  const onUserMove = useCallback(() => dispatch({ type: 'userMove' }), []);

  // live 위치가 움직이면 같은 규칙으로 받는다. live가 생기면 GPS 감시는 끄고, live가 끝났는데 GPS가 없으면 끈다
  const liveLat = live?.coord.latitude;
  const liveLng = live?.coord.longitude;
  const liveAcc = live?.accuracyM;
  useEffect(() => {
    const l = liveRef.current;
    if (modeRef.current === 'off') return;
    if (l) {
      if (sourceRef.current === 'gps') {
        stopWatch();
        sourceRef.current = 'live';
      }
      onFix(l);
    } else if (sourceRef.current === 'live') {
      // live 위치만 쓰던 중 여행이 끝났다. GPS를 몰래 켜지 않고 끈다(다시 누르면 GPS로 찾는다)
      turnOff();
    }
  }, [liveLat, liveLng, liveAcc, onFix, stopWatch, turnOff]);

  // 화면이 가려지면 끈다
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) turnOff();
  }, [focused, turnOff]);

  // 앱이 뒤로 가면 끈다(전경 위치만 쓴다)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') turnOff();
    });
    return () => sub.remove();
  }, [turnOff]);

  // 지도가 내려가면 끈다
  useEffect(() => () => stopWatch(), [stopWatch]);

  return {
    mode,
    user: live ?? (mode === 'off' ? undefined : fix),
    // 위치를 받은 뒤(centered·follow)에만 이동 요청을 넘긴다. 찾는 중에는 지도를 옮기지 않는다
    center: mode === 'centered' || mode === 'follow' ? center : undefined,
    onTap,
    onUserMove,
  };
}
