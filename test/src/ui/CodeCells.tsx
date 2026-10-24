import React, { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { codeCellChars } from './codeChars';
import { Txt } from './Txt';
import { H, lineC, R, SP, surfaceC, T, textC } from './tokens';

/**
 * 코드 칸(2026-10-23 피그마 최종안 06). 글자마다 네모 칸, groupAt 뒤에 '-'. 지금 적을 칸은 잉크 2px 테두리.
 * 실제 입력은 칸 위에 겹친 투명 TextInput 하나가 받는다(붙여 넣기·링크 붙여 넣기 그대로 된다). 칸을 누르면 입력에 초점이 간다.
 */
export function CodeCells({
  label,
  value,
  onChangeText,
  onSubmitEditing,
  error,
  length = 8,
  groupAt = 4,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  onSubmitEditing?: () => void;
  error?: string;
  length?: number;
  groupAt?: number;
}) {
  const ref = useRef<TextInput>(null);
  const [focus, setFocus] = useState(false);
  const chars = codeCellChars(value, length);
  const cells = Array.from({ length }, (_, i) => chars[i] ?? '');
  return (
    <View style={{ gap: SP.s }}>
      <Pressable accessible={false} onPress={() => ref.current?.focus()} style={{ position: 'relative' }}>
        <View aria-hidden style={{ flexDirection: 'row', alignItems: 'center', gap: SP.xs }}>
          {cells.map((c, i) => (
            <React.Fragment key={i}>
              {i === groupAt ? <Txt v="ttlSm" c="muted">-</Txt> : null}
              <View
                style={{
                  flex: 1,
                  height: H.field,
                  borderRadius: R.field,
                  borderWidth: focus && i === Math.min(chars.length, length - 1) ? 2 : 1,
                  borderColor: error ? textC.warn : focus && i === Math.min(chars.length, length - 1) ? lineC.ink : lineC.line,
                  backgroundColor: surfaceC.card,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Txt v="ttlSm">{c}</Txt>
              </View>
            </React.Fragment>
          ))}
        </View>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onSubmitEditing={onSubmitEditing}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="go"
          caretHidden
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.01,
            color: textC.ink,
            fontFamily: T.field.fontFamily,
          }}
        />
      </Pressable>
      {error ? <Txt v="mtTight" c="warn">{error}</Txt> : null}
    </View>
  );
}
