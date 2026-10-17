import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bootstrap } from './src/features/account/bootstrap';
import { OfflineBar } from './src/navigation/OfflineBar';
import { linking } from './src/navigation/routes';
import { navTheme, RootNavigator } from './src/navigation/RootNavigator';
import { ToastHost } from './src/navigation/ToastHost';
import SplashScreen from './src/screens/SplashScreen';
import { useSession } from './src/store/session';
import { useUi } from './src/store/ui';

/**
 * Young Trip 진입점. 부팅(bootstrap: 폰트 4개, 저장소 4개 복원, 세션 갱신) 동안 01 스플래시를 그리고,
 * 끝나면 루트 스택을 띄운다. 라우트 등록 규칙은 src/navigation/routes.ts(A8)에 있다.
 * 오프라인 안내(OfflineBar)는 루트 스택 위 한 줄로 앱 전체에 하나다.
 */
export default function App() {
  const [boot, setBoot] = useState({ progress: 0, label: '준비 중' });
  const [ready, setReady] = useState(false);
  const hasSession = useSession((s) => s.session != null);

  useEffect(() => {
    let alive = true;
    void bootstrap((p) => {
      if (alive) setBoot({ progress: p.total > 0 ? p.done / p.total : 1, label: p.label });
    }).then((r) => {
      if (!alive) return;
      if (r.notices.length > 0) useUi.getState().showToast(r.notices.join(' '), 'warn');
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style={ready ? 'dark' : 'light'} />
      {ready ? (
        <View style={{ flex: 1 }}>
          <OfflineBar />
          <View style={{ flex: 1 }}>
            <NavigationContainer linking={linking} theme={navTheme}>
              <RootNavigator hasSession={hasSession} />
            </NavigationContainer>
          </View>
        </View>
      ) : (
        <SplashScreen progress={boot.progress} label={boot.label} />
      )}
      {ready ? <ToastHost /> : null}
    </SafeAreaProvider>
  );
}
