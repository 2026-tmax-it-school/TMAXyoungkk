import React from 'react';
import { Pressable, View } from 'react-native';

import { H, Icon, lineC, R, SP, surfaceC, Txt, type IconName } from '../../../ui';

/**
 * 눌러서 고르는 입력 칸. 지역·날짜·기점·활동시간처럼 텍스트로 치지 않는 값에 쓴다.
 * 모양은 DS TextField(ui Field)와 같다: 높이 56 상자 안 위쪽에 라벨(mtTight), 그 아래에 값 또는 안내문(muted).
 * 테두리는 line-strong 1px이고 error면 앰버 2px이다(굵어지는 만큼 안쪽 여백을 줄여 글자가 밀리지 않게 한다).
 * 아이콘은 상자 오른쪽 끝에 둔다. 비활성이면 off 면이다. 오류 글은 상자 아래에 앰버 글씨로 둔다.
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
  a11yLabel,
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
  /** 스크린리더 이름. 없으면 '라벨 값' */
  a11yLabel?: string;
}) {
  const bad = !!error;
  return (
    <View style={{ gap: SP.s }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11yLabel ?? `${label} ${value ?? placeholder ?? ''}`}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
        style={{
          minHeight: H.field,
          paddingHorizontal: bad ? 11 : 12,
          paddingVertical: bad ? 7 : 8,
          borderWidth: bad ? 2 : 1,
          borderColor: bad ? surfaceC.amber : lineC.strong,
          borderRadius: R.field,
          backgroundColor: disabled ? surfaceC.off : surfaceC.card,
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP.m,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="mtTight" numberOfLines={1}>
            {label}
          </Txt>
          <Txt v="body" c={value ? 'ink' : 'muted'} numberOfLines={1}>
            {value ?? placeholder ?? ''}
          </Txt>
        </View>
        {trailing}
        {icon ? <Icon name={icon} size={18} color={disabled ? 'faint' : 'muted'} /> : null}
      </Pressable>
      {error ? (
        <View accessibilityLiveRegion="polite">
          <Txt v="mtTight" c="warn">
            {error}
          </Txt>
        </View>
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
