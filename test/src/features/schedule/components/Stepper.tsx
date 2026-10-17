import React from 'react';
import { View } from 'react-native';

import { H, IconBtn, SP, Txt } from '../../../ui';

/**
 * 값 한 줄 조절기(10 일정 편집 도구 카드). 왼쪽에 라벨과 지금 값, 오른쪽에 빼기·더하기 아이콘 버튼(각 44 이상).
 * 버튼 이름은 실제 동작대로 쓴다('체류 15분 줄이기'). 끝값이면 그 버튼을 끈다.
 * extra는 값 아래 보조 줄(예: 도착 시각 '지정 풀기' 링크)이다.
 */
export function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
  minusDisabled,
  plusDisabled,
  extra,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.s, minHeight: H.touch }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="mtTight">{label}</Txt>
        <Txt v="nm" numberOfLines={1}>
          {value}
        </Txt>
        {extra}
      </View>
      <IconBtn icon="minus" label={minusLabel} variant="soft" disabled={minusDisabled} onPress={onMinus} />
      <IconBtn icon="plus" label={plusLabel} variant="soft" disabled={plusDisabled} onPress={onPlus} />
    </View>
  );
}
