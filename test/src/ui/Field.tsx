import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { fieldKindProps, type FieldKind } from './fieldKind';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { H, lineC, R, SP, surfaceC, T, textC } from './tokens';

/** 여러 줄 입력의 한 줄 높이(T.field 행간) */
const LINE_H = T.field.lineHeight;
/** '보기'/'숨기기' 글자 버튼의 위아래 hitSlop. 글자 행간(btnSm)에 더해 누르는 높이가 44(H.touch)가 되게 한다 */
const REVEAL_SLOP_V = (H.touch - T.btnSm.lineHeight) / 2;

/**
 * 입력 칸(DS TextField). 높이 56, 라운드 8, line-strong 1px. 라벨은 칸 안의 안내문으로 보인다(선택 상자 PickerBox와 같은 모양,
 *   입력하면 사라진다). 글자 수 제한이 있으면 오른쪽 끝에 센다.
 * 포커스는 잉크 2px, 오류는 앰버 2px 테두리와 아래 한 줄(주색을 오류에 쓰지 않는다). 안내문(placeholder)은 muted.
 * - hideLabel: 라벨을 화면에 그리지 않는다. 접근성 이름은 label 그대로다(05 입력줄처럼 라벨 없는 한 줄).
 * - size 'sm': 높이 44(H.fieldSm). 옆의 44 아이콘 버튼과 줄을 맞춘다.
 * - multiline: 여러 줄 입력(21 일기 문단). minLines 줄만큼 높이를 잡고 글자는 위에서 시작한다.
 * - look 'auth': 15 로그인·16 회원가입 모양(높이 48, 작은 라운드 6). 소셜 버튼(ui/Auth AuthBtn)과 줄을 맞춘다.
 * - look 'pill': 05 채팅 입력줄(2026-10-17, 메신저형). 높이 48 알약, 연한 테두리, 오른쪽 안에 right(보내기 버튼).
 * - keepFocusOnSubmit: 엔터를 눌러도 키보드를 내리지 않는다(29 커뮤니티 태그처럼 연달아 넣는 칸). 네이티브는 submitBehavior,
 *   웹(react-native-web)은 blurOnSubmit를 본다. returnKeyType·autoCapitalize·onBlur는 그대로 넘긴다.
 * - kind: 칸 종류(이메일·아이디·비밀번호·새 비밀번호·닉네임·초대 코드). 자동완성·자동 고침·키보드·엔터 키 기본값을
 *   ui/fieldKind 표에서 정한다. 직접 준 keyboardType·returnKeyType·autoCapitalize가 이긴다. 비밀번호 종류는 secure가 기본이다.
 * - inputRef: 앞 칸의 엔터(returnKeyType 'next')에서 이 칸으로 포커스를 넘길 때 쓴다.
 * - secure 칸에는 오른쪽에 '보기'/'숨기기' 글자 버튼이 있다. 칸 높이는 그대로이고, 누르는 높이는 hitSlop으로 44(H.touch)다.
 * - 오류 줄은 accessibilityLiveRegion polite로 스크린리더가 바로 읽는다.
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
  look = 'default',
  keepFocusOnSubmit,
  returnKeyType,
  autoCapitalize,
  onBlur,
  kind,
  inputRef,
  right,
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
  look?: 'default' | 'auth' | 'pill';
  keepFocusOnSubmit?: boolean;
  returnKeyType?: 'done' | 'next' | 'go' | 'search' | 'send';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onBlur?: () => void;
  kind?: FieldKind;
  inputRef?: React.Ref<TextInput>;
  /** 칸 안 오른쪽 끝에 두는 것(05 입력줄의 보내기 버튼). 글자와 같은 줄에 있다 */
  right?: React.ReactNode;
}) {
  const [focus, setFocus] = useState(false);
  const [shown, setShown] = useState(false);
  const k = kind ? fieldKindProps(kind) : undefined;
  const masked = secure ?? (kind === 'password' || kind === 'newPassword');
  // DS TextField: 라벨이 칸 안 안내문이다. 라벨을 숨기면 44/56 한 줄 칸에 placeholder만 보인다.
  // look auth(15·16)는 높이 48·라운드 6이다(안내문만 보인다).
  const auth = look === 'auth';
  const pill = look === 'pill';
  const inside = !hideLabel && !auth && !pill;
  const boxH = auth || pill ? H.auth : size === 'sm' ? H.fieldSm : H.field;
  const padV = multiline ? 8 : size === 'sm' ? 8 : 10;
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
          minHeight: multiline ? Math.max(boxH, LINE_H * minLines + 16) : boxH,
          // 포커스 때 테두리가 1 → 2로 굵어지는 만큼 안쪽 여백을 줄여 글자가 밀리지 않게 한다.
          paddingLeft: (focus || error ? 11 : 12) + (pill ? SP.s : 0),
          paddingRight: (focus || error ? 11 : 12) - (pill && right ? 6 : 0),
          paddingVertical: 0,
          borderWidth: focus || error ? 2 : 1,
          borderColor: error ? surfaceC.amber : pill && !focus ? lineC.strong : ring,
          borderRadius: auth ? R.auth : pill ? R.chip : R.field,
          backgroundColor: surfaceC.card,
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: SP.m,
        }}
      >
        <View style={{ flex: 1, flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', gap: SP.m }}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            placeholder={inside ? label : placeholder}
            placeholderTextColor={textC.muted}
            maxLength={maxLength}
            secureTextEntry={masked && !shown}
            keyboardType={keyboardType ?? k?.keyboardType}
            multiline={multiline}
            onSubmitEditing={onSubmitEditing}
            submitBehavior={keepFocusOnSubmit ? 'submit' : undefined}
            blurOnSubmit={keepFocusOnSubmit ? false : undefined}
            returnKeyType={returnKeyType ?? k?.returnKeyType}
            autoCapitalize={autoCapitalize ?? k?.autoCapitalize}
            autoCorrect={k?.autoCorrect}
            autoComplete={k?.autoComplete}
            textContentType={k?.textContentType}
            onFocus={() => setFocus(true)}
            onBlur={() => {
              setFocus(false);
              onBlur?.();
            }}
            accessibilityLabel={label}
            style={[
              T.field,
              { flex: 1, minWidth: 0, color: textC.ink, paddingVertical: padV, outlineWidth: 0, outlineStyle: 'solid' },
              multiline ? { minHeight: LINE_H * minLines, textAlignVertical: 'top' } : null,
            ]}
          />
          {masked ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={shown ? `${label} 숨기기` : `${label} 보기`}
              onPress={() => setShown((v) => !v)}
              hitSlop={{ top: REVEAL_SLOP_V, bottom: REVEAL_SLOP_V, left: SP.m, right: SP.m }}
            >
              <Txt v="btnSm" c="muted">
                {shown ? '숨기기' : '보기'}
              </Txt>
            </Pressable>
          ) : null}
          {inside && maxLength ? (
            <View style={{ paddingTop: multiline ? padV : 0 }}>
              <Txt v="mtTight">{`${value.length} / ${maxLength}`}</Txt>
            </View>
          ) : null}
          {right}
        </View>
      </View>
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

/**
 * 선택 상자 묶음(04 이동수단). 높이 36, 라운드 8. DS 규칙대로 선택은 잉크로 표시한다:
 * 켜진 것은 흰 면에 잉크 2px 테두리·잉크 글씨, 안 고른 것은 line-strong 1px, 비활성은 Btn off와 같은 면과 글씨.
 * scroll: 칸이 많을 때(일정 편집 날짜) 가로 한 줄로 두고 넘치면 가로로 민다. 칸은 글자 폭만큼이다.
 */
export function Choice<K extends string>({
  options,
  value,
  onChange,
  scroll,
}: {
  options: { key: K; label: string; icon?: IconName; badge?: React.ReactNode; disabled?: boolean }[];
  value: K;
  onChange: (key: K) => void;
  scroll?: boolean;
}) {
  const row = (
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
              flex: scroll ? undefined : 1,
              minHeight: H.btnSm,
              paddingHorizontal: scroll ? SP.xl : SP.l,
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
  if (!scroll) return row;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {row}
    </ScrollView>
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
