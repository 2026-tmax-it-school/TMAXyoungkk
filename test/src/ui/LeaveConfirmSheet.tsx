import React from 'react';
import { View } from 'react-native';

import { Btn } from './Btn';
import { Sheet } from './Sheet';
import { Txt } from './Txt';
import { SP } from './tokens';

/**
 * 바뀐 내용이 있는 화면을 떠날 때 한 번 묻는 시트(입력을 잃지 않는다).
 * 주 버튼은 '저장하고 나가기' 하나, 그 아래 '저장하지 않고 나가기'와 '취소'(머무르기)는 quiet다.
 * saveDisabledReason이 있으면 저장을 끄고 그 이유를 한 줄로 보인다(예: 닉네임 오류).
 * 화면은 beforeRemove·usePreventRemove로 나가기를 막고 이 시트를 띄운 뒤, 저장·버리기에서 막아 둔 동작을 dispatch한다.
 */
export function LeaveConfirmSheet({
  visible,
  title,
  text,
  saveLabel = '저장하고 나가기',
  onSave,
  discardLabel = '저장하지 않고 나가기',
  onDiscard,
  onCancel,
  saveDisabledReason,
}: {
  visible: boolean;
  title: string;
  text?: string;
  saveLabel?: string;
  onSave: () => void;
  discardLabel?: string;
  onDiscard: () => void;
  onCancel: () => void;
  saveDisabledReason?: string;
}) {
  return (
    <Sheet visible={visible} onClose={onCancel} title={title}>
      {text ? (
        <Txt v="body" c="muted">
          {text}
        </Txt>
      ) : null}
      {saveDisabledReason ? (
        <View accessibilityLiveRegion="polite">
          <Txt v="mt" c="warn">
            {saveDisabledReason}
          </Txt>
        </View>
      ) : null}
      <View style={{ gap: SP.m }}>
        <Btn title={saveLabel} onPress={onSave} disabled={!!saveDisabledReason} />
        <Btn title={discardLabel} variant="quiet" onPress={onDiscard} />
        <Btn title="취소" variant="quiet" onPress={onCancel} />
      </View>
    </Sheet>
  );
}
