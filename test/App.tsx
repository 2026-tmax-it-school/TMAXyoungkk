import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bootstrap } from './src/features/account/bootstrap';
import { linking } from './src/navigation/routes';
import { navTheme, RootNavigator } from './src/navigation/RootNavigator';
import { ToastHost } from './src/navigation/ToastHost';
import SplashScreen from './src/screens/SplashScreen';
import { useSession } from './src/store/session';
import { useUi } from './src/store/ui';

/**
 * Young Trip 진입점. 부팅(bootstrap: 폰트 4개, 저장소 4개 복원, 세션 갱신) 동안 01 스플래시를 그리고,
 * 끝나면 루트 스택을 띄운다. 라우트 등록 규칙은 src/navigation/routes.ts(A8)에 있다.
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
        <NavigationContainer linking={linking} theme={navTheme}>
          <RootNavigator hasSession={hasSession} />
        </NavigationContainer>
      ) : (
        <SplashScreen progress={boot.progress} label={boot.label} />
      )}
      {ready ? <ToastHost /> : null}
    </SafeAreaProvider>
  );
}
