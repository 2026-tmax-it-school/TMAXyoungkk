import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

/**
 * 공유(초대 링크 FR-301, 일기 FR-703). 공유 시트가 안 되면 클립보드 복사로 대체한다.
 * react-native-web의 Share는 navigator.share가 없는 브라우저에서 reject한다.
 * 클립보드도 비보안 출처(LAN http)나 일부 브라우저에서 실패할 수 있어 'failed'를 돌려준다.
 * 사용자가 공유 시트를 닫으면 'dismissed'다(iOS dismissedAction, 웹 navigator.share의 AbortError).
 * 이때는 복사로 넘어가지 않고, 부르는 쪽은 공유 기록을 남기지 않는다.
 */
export type ShareOutcome = 'shared' | 'copied' | 'failed' | 'dismissed';

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e != null && (e as { name?: unknown }).name === 'AbortError';
}

export async function shareText(input: { title?: string; text: string }): Promise<ShareOutcome> {
  try {
    const r = await Share.share(input.title ? { title: input.title, message: input.text } : { message: input.text });
    // 웹 navigator.share는 undefined로 끝난다. 네이티브는 action으로 닫음을 알린다.
    return r != null && r.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch (e) {
    if (isAbort(e)) return 'dismissed';
    return copyText(input.text);
  }
}

export async function copyText(text: string): Promise<ShareOutcome> {
  try {
    const ok = await Clipboard.setStringAsync(text);
    return ok ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}
