import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Btn } from './Btn';
import { Txt } from './Txt';
import { H, lineC, R, SP, surfaceC } from './tokens';

/** 아래에서 올라오는 시트. 라운드 16, 그림자 없음, 위쪽 잡이 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="닫기" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(26,16,20,0.28)' }} />
      <View
        style={{
          backgroundColor: surfaceC.card,
          borderTopWidth: 1,
          borderTopColor: lineC.line,
          borderTopLeftRadius: R.sheet,
          borderTopRightRadius: R.sheet,
          paddingTop: SP.xl,
          paddingHorizontal: SP.gutter,
          paddingBottom: SP.section + insets.bottom,
          gap: SP.xl,
        }}
      >
        <View
          style={{
            width: H.grabberW,
            height: H.grabberH,
            borderRadius: H.grabberH / 2,
            backgroundColor: surfaceC.grabber,
            alignSelf: 'center',
          }}
        />
        {title ? <Txt v="ttlSm">{title}</Txt> : null}
        {children}
      </View>
    </Modal>
  );
}

/** 삭제·나가기·내보내기·계정 탈퇴 확인 1회. 위험 색을 쓰지 않는다. */
export function ConfirmSheet({
  visible,
  title,
  text,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onCancel} title={title}>
      <Txt v="body" c="muted">
        {text}
      </Txt>
      <View style={{ gap: 9 }}>
        <Btn title={confirmLabel} onPress={onConfirm} />
        <Btn title="취소" variant="quiet" onPress={onCancel} />
      </View>
    </Sheet>
  );
}
