import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bootstrap } from './src/features/account/bootstrap';
import { LocationConsentDialog } from './src/features/live/components/LocationConsentDialog';
import { OfflineBar } from './src/navigation/OfflineBar';
import { linking } from './src/navigation/routes';
import { navTheme, RootNavigator } from './src/navigation/RootNavigator';
import { ToastHost } from './src/navigation/ToastHost';
import SplashScreen from './src/screens/SplashScreen';
import { useSession } from './src/store/session';
import { useUi } from './src/store/ui';

/** 부팅이 빨리 끝나도 스플래시가 번쩍이고 사라지지 않게 최소로 보여 주는 시간 */
const SPLASH_MIN_MS = 1500;

/**
 * Young Trip 진입점. 부팅(bootstrap: 폰트 4개, 저장소 4개 복원, 세션 갱신) 동안 01 스플래시를 그리고(워드마크가 뜬 뒤 최소 1.5초),
 * 끝나면 루트 스택을 띄운다. 라우트 등록 규칙은 src/navigation/routes.ts(A8)에 있다.
 * 오프라인 안내(OfflineBar)는 루트 스택 위 한 줄로 앱 전체에 하나다. 위치 사용 동의 대화상자(LocationConsentDialog)도 하나다.
 */
export default function App() {
  const [boot, setBoot] = useState({ progress: 0, label: '준비 중' });
  const [ready, setReady] = useState(false);
  const hasSession = useSession((s) => s.session != null);
  // 스플래시 워드마크가 실제로 화면에 뜬 때(SplashScreen onShown). 최소 시간은 여기서부터 센다
  const [splashShown] = useState(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  });

  useEffect(() => {
    let alive = true;
    const minShown = splashShown.promise.then(() => new Promise((r) => setTimeout(r, SPLASH_MIN_MS)));
    const booted = bootstrap((p) => {
      if (alive) setBoot({ progress: p.total > 0 ? p.done / p.total : 1, label: p.label });
    });
    void Promise.all([booted, minShown]).then(([r]) => {
      if (!alive) return;
      if (r.notices.length > 0) useUi.getState().showToast(r.notices.join(' '), 'warn');
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [splashShown]);

  return (
    <SafeAreaProvider>
      <StatusBar style={ready ? 'dark' : 'light'} />
      {ready ? (
        <View style={{ flex: 1 }}>
          <OfflineBar />
          <View style={{ flex: 1 }}>
            {/* 웹 탭 제목에 라우트 이름(Main, LiveTrip 등)이 그대로 보이지 않게 앱 이름으로 고정한다 */}
            <NavigationContainer linking={linking} theme={navTheme} documentTitle={{ formatter: () => 'Young Trip' }}>
              <RootNavigator hasSession={hasSession} />
            </NavigationContainer>
          </View>
        </View>
      ) : (
        <SplashScreen progress={boot.progress} label={boot.label} minMs={SPLASH_MIN_MS} onShown={splashShown.resolve} />
      )}
      {ready ? <ToastHost /> : null}
      {/* 위치를 처음 쓰려 할 때 묻는 대화상자(앱 전체에 하나) */}
      {ready ? <LocationConsentDialog /> : null}
    </SafeAreaProvider>
  );
}
