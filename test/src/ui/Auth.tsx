import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { BrandLogo } from './BrandLogo';
import { Txt } from './Txt';
import { brandC, H, lineC, R, SP, surfaceC, type TextColorKey } from './tokens';

/**
 * 15 로그인·16 회원가입 전용 모양(2026-10-10 사용자 시안). 흰 바탕, 가운데 큰 제목, 높이 48·라운드 6의 직사각형 버튼.
 * 소셜 버튼은 브랜드 가이드를 따른다: 카카오는 노란 면에 검정 말풍선, 구글은 흰 면·회색 테두리에 네 색 G. 로고는 왼쪽, 글자는 가운데.
 */

/** 가운데 큰 제목('로그인', '회원가입') */
export function AuthTitle({ title }: { title: string }) {
  return (
    <View style={{ paddingTop: SP.section, paddingBottom: SP.xl }}>
      <Txt v="authTitle" center>
        {title}
      </Txt>
    </View>
  );
}

export type AuthBtnVariant = 'primary' | 'outline' | 'kakao' | 'google';

const LOOK: Record<AuthBtnVariant, { box: ViewStyle; text: TextColorKey }> = {
  primary: { box: { backgroundColor: surfaceC.ink }, text: 'onInk' },
  outline: { box: { backgroundColor: surfaceC.card, borderWidth: 1, borderColor: lineC.accent }, text: 'ink' },
  kakao: { box: { backgroundColor: surfaceC.kakao }, text: 'onKakao' },
  google: { box: { backgroundColor: surfaceC.card, borderWidth: 1, borderColor: brandC.googleLine }, text: 'ink' },
};

/**
 * 가로 꽉 찬 버튼. primary(잉크 면), outline(흰 면·잉크 테두리), kakao, google.
 * disabled면 Btn off와 같은 회색 면이다(소셜 버튼은 막지 않고 누르면 이유를 알린다).
 */
export function AuthBtn({
  title,
  onPress,
  variant = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: AuthBtnVariant;
  disabled?: boolean;
}) {
  const look = disabled ? { box: { backgroundColor: surfaceC.off }, text: 'muted' as const } : LOOK[variant];
  const brand = variant === 'kakao' || variant === 'google' ? variant : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        {
          height: H.auth,
          borderRadius: R.auth,
          paddingHorizontal: SP.xxl,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        },
        look.box,
      ]}
    >
      {brand ? (
        <View style={{ position: 'absolute', left: SP.xxl, top: 0, bottom: 0, justifyContent: 'center' }}>
          <BrandLogo brand={brand} />
        </View>
      ) : null}
      <Txt v="btn" c={look.text}>
        {title}
      </Txt>
    </Pressable>
  );
}

/** 밑줄 글자 링크('계정찾기'). align right면 오른쪽 끝에 붙는다 */
export function TextLink({ title, onPress, align = 'left' }: { title: string; onPress: () => void; align?: 'left' | 'right' }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      hitSlop={8}
      style={{ alignSelf: align === 'right' ? 'flex-end' : 'flex-start', paddingVertical: SP.xs }}
    >
      <Txt v="mt" c="muted" underline>
        {title}
      </Txt>
    </Pressable>
  );
}

/** 가로 구분선(1px line) */
export function Divider() {
  return <View accessibilityElementsHidden importantForAccessibility="no" style={{ height: 1, backgroundColor: lineC.line, marginVertical: SP.s }} />;
}
