import React from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { Btn, IconBtn } from './Btn';
import { KeyboardAvoid, useBottomInset } from './KeyboardAvoid';
import { Txt } from './Txt';
import { H, lineC, R, SP, surfaceC } from './tokens';

/** 시트 패널의 최대 높이(창 높이 대비) */
const SHEET_MAX_RATIO = 0.85;

/**
 * 아래에서 올라오는 시트. 라운드 16, 그림자 없음, 위쪽 잡이.
 * - 패널은 늘 KeyboardAvoid(iOS·안드로이드 padding) 안에 있어 키보드가 시트 입력 칸과 버튼을 가리지 않는다.
 * - scroll이 켜졌을 때 패널 높이는 창 높이의 85%까지이고 넘치는 내용은 안에서 스크롤한다.
 *   scroll이 꺼진 시트는 상한을 두지 않는다(줄일 수 없는 내용이 화면 아래로 잘리지 않게, 예: 날짜 고르기 달력).
 * - scroll: 내용을 ScrollView로 감싼다(기본 꺼짐). 켜면 키보드가 열린 채로 결과를 처음 누를 때 바로 눌린다(handled).
 *   FlatList나 검색 목록이 든 시트(직접 추가, 동명 장소 고르기, 기점 검색, 묶음 목록)는 중첩 VirtualizedList가 되지 않게 꺼 둔다.
 * - title이 있으면 오른쪽에 닫기 아이콘 버튼을 둔다.
 */
export function Sheet({
  visible,
  onClose,
  title,
  scroll = false,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  scroll?: boolean;
  children?: React.ReactNode;
}) {
  const bottom = useBottomInset();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoid>
        <Pressable accessibilityLabel="닫기" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(26,16,20,0.28)' }} />
        <View
          style={{
            maxHeight: scroll ? Math.round(height * SHEET_MAX_RATIO) : undefined,
            backgroundColor: surfaceC.card,
            borderTopWidth: 1,
            borderTopColor: lineC.line,
            borderTopLeftRadius: R.sheet,
            borderTopRightRadius: R.sheet,
            paddingTop: SP.xl,
            paddingHorizontal: SP.gutter,
            paddingBottom: SP.section + bottom,
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
          {title ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.m }}>
              <View accessibilityRole="header" style={{ flex: 1 }}>
                <Txt v="ttlSm">{title}</Txt>
              </View>
              <IconBtn icon="x" label="닫기" onPress={onClose} />
            </View>
          ) : null}
          {scroll ? (
            <ScrollView
              style={{ flexGrow: 0, flexShrink: 1 }}
              contentContainerStyle={{ gap: SP.xl }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </KeyboardAvoid>
    </Modal>
  );
}

/**
 * 삭제·나가기·내보내기·계정 탈퇴 확인 1회. 위험 색을 쓰지 않는다.
 * 버튼은 확인과 취소 둘뿐이다. cancelLabel로 취소 글자를 바꾸고('계속 만들기'), confirmDisabled로 확인을 끈다.
 * children은 설명 아래에 덧붙이는 내용(이유 한 줄 등)이다.
 * 이 함수 뒤에는 버튼을 그리는 다른 컴포넌트를 두지 않는다(wp6 테스트가 이 아래 버튼 수를 센다).
 */
export function ConfirmSheet({
  visible,
  title,
  text,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = '취소',
  confirmDisabled,
  children,
}: {
  visible: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Sheet visible={visible} onClose={onCancel} title={title}>
      <Txt v="body" c="muted">
        {text}
      </Txt>
      {children}
      <View style={{ gap: 9 }}>
        <Btn title={confirmLabel} onPress={onConfirm} disabled={confirmDisabled} />
        <Btn title={cancelLabel} variant="quiet" onPress={onCancel} />
      </View>
    </Sheet>
  );
}
