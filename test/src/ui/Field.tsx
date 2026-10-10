import React, { useState } from 'react';
import { Pressable, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { H, lineC, R, SP, surfaceC, T, textC } from './tokens';

/** 여러 줄 입력의 한 줄 높이(T.field 행간) */
const LINE_H = T.field.lineHeight;

/**
 * 입력 칸(DS TextField). 라벨이 칸 안 위쪽에 붙고 높이 56, 라운드 8, line-strong 1px.
 * 포커스는 잉크 2px, 오류는 앰버 2px 테두리와 아래 한 줄(주색을 오류에 쓰지 않는다). 안내문(placeholder)은 muted.
 * - hideLabel: 라벨을 화면에 그리지 않는다. 접근성 이름은 label 그대로다(05 입력줄처럼 라벨 없는 한 줄).
 * - size 'sm': 높이 44(H.fieldSm). 옆의 44 아이콘 버튼과 줄을 맞춘다.
 * - multiline: 여러 줄 입력(21 일기 문단). minLines 줄만큼 높이를 잡고 글자는 위에서 시작한다.
 */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  help,
  error,
  secure,
  keyboardType,
  hideLabel,
  size = 'md',
  multiline,
  minLines = 3,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  help?: string;
  error?: string;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  hideLabel?: boolean;
  size?: 'md' | 'sm';
  multiline?: boolean;
  minLines?: number;
  onSubmitEditing?: () => void;
}) {
  const [focus, setFocus] = useState(false);
  // DS TextField: 라벨이 칸 안 위쪽(작은 muted 글자). 라벨을 숨기면 44/56 한 줄 칸이다.
  const inside = !hideLabel;
  const boxH = size === 'sm' ? H.fieldSm : H.field;
  const padV = inside ? 0 : size === 'sm' ? 8 : 10;
  const ring = focus ? lineC.ink : lineC.strong;
  return (
    <View style={{ gap: SP.s }}>
      {hideLabel && maxLength ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Txt v="mtTight">{`${value.length} / ${maxLength}`}</Txt>
        </View>
      ) : null}
      <View
        style={{
          minHeight: multiline ? Math.max(boxH, LINE_H * minLines + 16 + (inside ? 18 : 0)) : boxH,
          // 포커스 때 테두리가 1 → 2로 굵어지는 만큼 안쪽 여백을 줄여 글자가 밀리지 않게 한다.
          paddingHorizontal: focus || error ? 11 : 12,
          paddingVertical: inside ? (focus || error ? 7 : 8) : 0,
          borderWidth: focus || error ? 2 : 1,
          borderColor: error ? surfaceC.amber : ring,
          borderRadius: R.field,
          backgroundColor: surfaceC.card,
          justifyContent: multiline ? 'flex-start' : 'center',
        }}
      >
        {inside ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Txt v="mtTight">{label}</Txt>
            </View>
            {maxLength ? <Txt v="mtTight">{`${value.length} / ${maxLength}`}</Txt> : null}
          </View>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={textC.muted}
          maxLength={maxLength}
          secureTextEntry={secure}
          keyboardType={keyboardType}
          multiline={multiline}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          accessibilityLabel={label}
          style={[
            T.field,
            { color: textC.ink, paddingVertical: padV },
            multiline ? { minHeight: LINE_H * minLines, textAlignVertical: 'top' } : null,
          ]}
        />
      </View>
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

/**
 * 선택 상자 묶음(04 이동수단). 높이 36, 라운드 8. DS 규칙대로 선택은 잉크로 표시한다:
 * 켜진 것은 흰 면에 잉크 2px 테두리·잉크 글씨, 안 고른 것은 line-strong 1px, 비활성은 Btn off와 같은 면과 글씨.
 */
export function Choice<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string; icon?: IconName; badge?: React.ReactNode; disabled?: boolean }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: SP.m }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!o.disabled }}
            disabled={o.disabled}
            onPress={() => onChange(o.key)}
            style={{
              flex: 1,
              minHeight: H.btnSm,
              paddingHorizontal: SP.l,
              borderRadius: R.btnSm,
              borderWidth: o.disabled && !on ? 0 : on ? 2 : 1,
              borderColor: on ? lineC.ink : lineC.strong,
              backgroundColor: o.disabled && !on ? surfaceC.off : surfaceC.card,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: SP.s,
            }}
          >
            {o.icon ? <Icon name={o.icon} size={17} color={on ? 'ink' : o.disabled ? 'faint' : 'muted'} /> : null}
            <Txt v="btnSm" c={on ? 'ink' : 'muted'}>
              {o.label}
            </Txt>
            {o.badge}
          </Pressable>
        );
      })}
    </View>
  );
}

/** 켜고 끄는 필터 칩(DS Chip, 성향 태그 등). 알약 높이 36. 켜지면 잉크 2px 테두리와 연회색 면. */
export function Tag({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={{
        height: H.btnSm,
        justifyContent: 'center',
        paddingHorizontal: on ? SP.xxl - 1 : SP.xxl,
        borderRadius: R.chip,
        borderWidth: on ? 2 : 1,
        borderColor: on ? lineC.ink : lineC.strong,
        backgroundColor: on ? surfaceC.soft : surfaceC.card,
      }}
    >
      <Txt v="btnSm" c="ink">
        {label}
      </Txt>
    </Pressable>
  );
}
