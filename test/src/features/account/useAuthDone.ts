import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { useEffect, useState } from 'react';

import { useSession } from '../../store/session';

/**
 * 로그인·가입·소셜이 끝나면 홈으로 보낸다. 세션이 생기면 루트 스택에 Main이 새로 등록되므로
 * 등록이 끝난 다음 렌더에서 reset한다(같은 틱에 navigate하면 아직 Main이 없다).
 */
export function useAuthDone(navigation: NavigationProp<ParamListBase>): () => void {
  const [done, setDone] = useState(false);
  const hasSession = useSession((s) => s.session != null);
  useEffect(() => {
    if (done && hasSession) navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  }, [done, hasSession, navigation]);
  return () => setDone(true);
}
