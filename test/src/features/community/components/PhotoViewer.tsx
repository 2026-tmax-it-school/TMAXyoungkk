import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CommunityPhoto } from '../../../core/ports';
import { H, IconBtn, Row, SP, surfaceC, Txt } from '../../../ui';

/**
 * 커뮤니티 사진 크게 보기(WP6 소유, 2026-10-11). 글 카드의 사진을 누르면 화면 가득 연다.
 * - 옆으로 밀어 넘긴다(가로 쪽 넘김). 웹·키보드 사용자를 위해 아래에 이전·다음 버튼도 둔다(사진이 둘 이상일 때).
 * - 위에 '2 / 4'와 닫기. 안드로이드 뒤로 버튼과 웹 Esc는 onRequestClose로 닫힌다.
 * - 바탕은 잉크(사진이 먼저 보이게). 사진은 비율을 지켜 화면 안에 맞춘다.
 */
export function PhotoViewer({
  visible,
  photos,
  index,
  name,
  uri,
  onClose,
}: {
  visible: boolean;
  photos: CommunityPhoto[];
  index: number;
  name: string;
  uri: (p: CommunityPhoto) => string;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [at, setAt] = useState(index);
  const ref = useRef<ScrollView>(null);
  const n = photos.length;
  const bar = H.iconBtn + SP.xl * 2;
  const pageH = Math.max(0, height - insets.top - insets.bottom - bar * 2);

  useEffect(() => {
    if (!visible) return;
    setAt(index);
    // 열린 뒤 고른 사진으로 옮긴다(contentOffset은 웹에서 받지 않는다)
    const t = setTimeout(() => ref.current?.scrollTo({ x: index * width, animated: false }), 0);
    return () => clearTimeout(t);
  }, [visible, index, width]);

  const go = (i: number) => {
    const next = Math.max(0, Math.min(n - 1, i));
    setAt(next);
    ref.current?.scrollTo({ x: next * width, animated: true });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== at && i >= 0 && i < n) setAt(i);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Row style={styles.bar}>
          <Txt v="nm" c="onInk" style={{ flex: 1 }}>
            {n > 1 ? `${at + 1} / ${n}` : ''}
          </Txt>
          <IconBtn icon="x" color="onInk" label="사진 닫기" onPress={onClose} />
        </Row>
        <ScrollView
          ref={ref}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={32}
          style={{ flex: 1 }}
        >
          {photos.map((p, i) => (
            <View key={p.id} style={[styles.page, { width, height: pageH }]}>
              <Image
                source={{ uri: uri(p) }}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
                accessibilityLabel={`${name}의 사진 ${i + 1} / ${n}`}
                style={{ width, height: pageH }}
              />
            </View>
          ))}
        </ScrollView>
        <Row style={styles.bar}>
          {n > 1 ? (
            <>
              <IconBtn icon="back" color="onInk" label="이전 사진" disabled={at <= 0} onPress={() => go(at - 1)} />
              <View style={{ flex: 1 }} />
              <IconBtn icon="right" color="onInk" label="다음 사진" disabled={at >= n - 1} onPress={() => go(at + 1)} />
            </>
          ) : null}
        </Row>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: surfaceC.ink },
  bar: { minHeight: H.iconBtn + SP.xl * 2, paddingHorizontal: SP.xxl },
  page: { alignItems: 'center', justifyContent: 'center' },
});
