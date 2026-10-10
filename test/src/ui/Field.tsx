import React, { useState } from 'react';
import { Pressable, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { H, lineC, R, SP, surfaceC, T, textC } from './tokens';

/** 여러 줄 입력의 한 줄 높이(T.field 행간) */
const LINE_H = T.field.lineHeight;

/**
 * 입력 칸(목업 .field). 안내문(placeholder)은 muted다. 목업의 #9C8B92는 대비 미달이라 올렸다.
 * 오류는 주색이 아니라 앰버 글씨로 쓴다.
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
  const boxH = size === 'sm' ? H.fieldSm : H.field;
  const padV = size === 'sm' ? 8 : 10;
  return (
    <View style={{ gap: SP.s }}>
      {hideLabel && !maxLength ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>{hideLabel ? null : <Txt v="label">{label}</Txt>}</View>
          {maxLength ? <Txt v="mtTight">{`${value.length} / ${maxLength}`}</Txt> : null}
        </View>
      )}
      <View
        style={{
          minHeight: multiline ? Math.max(boxH, LINE_H * minLines + padV * 2) : boxH,
          // 포커스 때 테두리가 1 → 2로 굵어지는 만큼 안쪽 여백을 줄여 글자가 밀리지 않게 한다.
          paddingHorizontal: focus ? 12 : 13,
          borderWidth: focus ? 2 : 1,
          borderColor: focus ? lineC.accent : lineC.line,
          borderRadius: R.field,
          backgroundColor: surfaceC.card,
          justifyContent: multiline ? 'flex-start' : 'center',
        }}
      >
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
 * 선택 상자 묶음(목업 04 이동수단). btn sm 모양(38/9)이다. 켜진 것은 주색(연두) 면에 흰 글씨,
 * 안 고른 것은 quiet(흰 면·line 테두리), 비활성은 Btn off와 같은 면과 글씨다. badge에는 ScopeBadge 등을 넣는다.
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
              borderWidth: o.disabled && !on ? 0 : 1,
              borderColor: on ? lineC.accent : lineC.line,
              backgroundColor: on ? surfaceC.accent : o.disabled ? surfaceC.off : surfaceC.card,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: SP.s,
            }}
          >
            {o.icon ? <Icon name={o.icon} size={17} color={on ? 'onAccent' : o.disabled ? 'faint' : 'muted'} /> : null}
            <Txt v="btnSm" c={on ? 'onAccent' : 'muted'}>
              {o.label}
            </Txt>
            {o.badge}
          </Pressable>
        );
      })}
    </View>
  );
}

/** 켜고 끄는 태그(성향 태그 등). 켜진 태그는 주색(연두) 면. */
export function Tag({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={{
        paddingVertical: 7,
        paddingHorizontal: 13,
        borderRadius: R.chip,
        borderWidth: 1,
        borderColor: on ? lineC.accent : lineC.line,
        backgroundColor: on ? surfaceC.accent : surfaceC.card,
      }}
    >
      <Txt v="chip" c={on ? 'onAccent' : 'muted'}>
        {label}
      </Txt>
    </Pressable>
  );
}
