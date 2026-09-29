import React from 'react';
import { Pressable, View } from 'react-native';

import { H, Icon, lineC, R, SP, surfaceC, Txt, type IconName } from '../../../ui';

/**
 * 눌러서 고르는 입력 칸(목업 04 .field .box). 지역·날짜·기점처럼 텍스트로 치지 않는 값에 쓴다.
 * 값이 없으면 안내문을 muted로 보여준다. error는 앰버 글씨다.
 */
export function PickerBox({
  label,
  icon,
  value,
  placeholder,
  trailing,
  help,
  error,
  onPress,
  disabled,
}: {
  label: string;
  icon?: IconName;
  value?: string;
  placeholder?: string;
  trailing?: React.ReactNode;
  help?: string;
  error?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: SP.s }}>
      <Txt v="label">{label}</Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} ${value ?? placeholder ?? ''}`}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
        style={{
          minHeight: H.field,
          paddingHorizontal: 13,
          paddingVertical: SP.m,
          borderWidth: 1,
          borderColor: lineC.line,
          borderRadius: R.field,
          backgroundColor: disabled ? surfaceC.off : surfaceC.card,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP.m,
        }}
      >
        {icon ? <Icon name={icon} size={16} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="body" c={value ? 'ink' : 'muted'} numberOfLines={1}>
            {value ?? placeholder ?? ''}
          </Txt>
        </View>
        {trailing}
      </Pressable>
      {error ? (
        <Txt v="mtTight" c="warn">
          {error}
        </Txt>
      ) : help ? (
        <Txt v="mtTight">{help}</Txt>
      ) : null}
    </View>
  );
}

/** 목록 시트 안의 한 줄. 켜진 줄은 체크 아이콘 */
export function PickRow({
  title,
  sub,
  on,
  onPress,
  icon,
}: {
  title: string;
  sub?: string;
  on?: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP.l,
        paddingVertical: SP.l,
        paddingHorizontal: SP.xl,
        borderRadius: R.field,
        borderWidth: 1,
        borderColor: on ? lineC.accent : lineC.line,
        backgroundColor: surfaceC.card,
      }}
    >
      {icon ? <Icon name={icon} size={16} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="nm" numberOfLines={1}>
          {title}
        </Txt>
        {sub ? (
          <Txt v="mtTight" numberOfLines={1}>
            {sub}
          </Txt>
        ) : null}
      </View>
      {on ? <Icon name="check" size={18} color="accent" /> : null}
    </Pressable>
  );
}
