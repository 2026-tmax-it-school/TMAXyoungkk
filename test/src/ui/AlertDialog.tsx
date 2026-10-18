import React from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';

import { Txt } from './Txt';
import { H, lineC, R, SP, surfaceC } from './tokens';

/** 대화상자 카드의 최대 너비(휴대폰 시스템 알림과 비슷한 폭) */
const DIALOG_MAX_W = 320;

export interface AlertAction {
  label: string;
  onPress: () => void;
  a11yLabel?: string;
}

/**
 * 가운데 뜨는 알림 대화상자(2026-10-17 사용자 요청: 위치 사용을 묻는 시스템 알림 모양).
 * 제목·설명은 가운데 정렬이고, 그 아래 children(지도 미리보기 같은 그림)이 카드 폭 가득 들어간다.
 * 버튼은 위아래로 쌓고 줄로 나눈다. 바깥을 눌러도 닫히지 않는다(고를 때까지 기다리는 질문이다).
 * 안드로이드 뒤로는 onRequestClose(보통 '허용 안 함'과 같게)를 부른다.
 */
export function AlertDialog({
  visible,
  title,
  text,
  children,
  actions,
  onRequestClose,
}: {
  visible: boolean;
  title: string;
  text?: string;
  children?: React.ReactNode;
  actions: AlertAction[];
  onRequestClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const cardW = Math.min(DIALOG_MAX_W, width - SP.gutter * 2);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(26,16,20,0.28)' }}
        accessibilityViewIsModal
      >
        <View
          accessibilityRole="alert"
          style={{
            width: cardW,
            backgroundColor: surfaceC.card,
            borderRadius: R.sheet,
            borderWidth: 1,
            borderColor: lineC.line,
            overflow: 'hidden',
          }}
        >
          <View style={{ paddingTop: SP.xxl + SP.xs, paddingBottom: SP.xxl, paddingHorizontal: SP.xxl, gap: SP.s }}>
            <Txt v="nmLg" center>
              {title}
            </Txt>
            {text ? (
              <Txt v="mt" c="muted" center>
                {text}
              </Txt>
            ) : null}
          </View>
          {children ? <View style={{ width: cardW }}>{children}</View> : null}
          {actions.map((a) => (
            <Pressable
              key={a.label}
              accessibilityRole="button"
              accessibilityLabel={a.a11yLabel ?? a.label}
              onPress={a.onPress}
              style={({ pressed }) => ({
                minHeight: H.btn,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: SP.xxl,
                borderTopWidth: 1,
                borderTopColor: lineC.line,
                backgroundColor: pressed ? surfaceC.soft : surfaceC.card,
              })}
            >
              <Txt v="btn" c="accent" center>
                {a.label}
              </Txt>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}
