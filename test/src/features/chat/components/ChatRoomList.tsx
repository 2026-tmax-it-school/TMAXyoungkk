import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { myMemberId, useMyTrips, useTrips } from '../../../store/trips';
import { useNow } from '../../../services/clock';
import { useUi } from '../../../store/ui';
import { Btn, ConfirmSheet, Icon, lineC, R, Sheet, SP, surfaceC, Txt } from '../../../ui';
import { chatRooms, deleteRoomPlan, filterRooms, roomTime, type ChatRoomRow } from '../rooms';

/**
 * 채팅방 목록(내 여행방마다 채팅방 하나). 채팅 목록 화면(ChatList)과 채팅 화면 머리의 방 바꾸기 시트에서 같이 쓴다.
 * - 방 하나는 정사각형 칸이고 한 줄에 두 칸이다(2026-10-17 사용자 요청). 칸 바탕은 여행방 표지(홈 카드와 같은 사진, 없으면 지역 이름),
 *   위에 고정·시각 알약, 아래 흰 판에 방 이름과 마지막 말(없으면 멤버 수)
 * - 누르면 onOpen(tripId)
 * - 꾹 누르면 메뉴 시트: 고정/고정 해제, 삭제. 삭제는 경고(ConfirmSheet) 뒤 그 여행방에서 나간다(방장은 여행방 삭제)
 * - current: 지금 보고 있는 방(채팅 화면 시트에서 표시)
 */
export function ChatRoomList({
  onOpen,
  current,
  onDeleted,
  inset = true,
  query = '',
}: {
  onOpen: (tripId: string) => void;
  current?: string;
  /** 삭제(나가기)가 끝난 뒤. 채팅 화면은 지금 방을 지웠으면 목록으로 나간다 */
  onDeleted?: (tripId: string) => void;
  /** 줄 좌우 여백(SP.gutter). 시트 안처럼 바깥에 이미 여백이 있으면 false */
  inset?: boolean;
  /** 검색어(방 이름·마지막 말). 비면 전부 */
  query?: string;
}) {
  const trips = useMyTrips();
  const pinned = useUi((s) => s.pinnedChats);
  const togglePin = useUi((s) => s.togglePinChat);
  const toast = useUi((s) => s.showToast);
  const dispatch = useTrips((s) => s.dispatch);
  const now = useNow(60_000);
  const [menuFor, setMenuFor] = useState<ChatRoomRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<ChatRoomRow | undefined>(undefined);
  // 정사각형 칸 두 줄 배치: 줄 폭을 재서 (폭 - 간격) / 2로 칸 한 변을 정한다
  const [gridW, setGridW] = useState(0);
  const all = chatRooms(trips, pinned ?? []);
  const rows = filterRooms(all, query);

  const deleteTrip = deleting ? trips.find((t) => t.id === deleting.tripId) : undefined;
  const me = deleteTrip ? myMemberId(deleteTrip) : undefined;
  const plan = deleteTrip && me ? deleteRoomPlan(deleteTrip, me) : undefined;

  if (all.length > 0 && rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Txt v="nm">{`'${query.trim()}' 채팅방이 없어요`}</Txt>
        <Txt v="mtTight">방 이름이나 대화 내용을 다른 말로 찾아 보세요</Txt>
      </View>
    );
  }
  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Txt v="nm">아직 채팅방이 없어요</Txt>
        <Txt v="mtTight">여행방을 만들거나 초대받으면 그 여행방의 채팅방이 여기에 생겨요</Txt>
      </View>
    );
  }

  const tile = gridW > 0 ? Math.floor((gridW - TILE_GAP) / 2) : 0;
  return (
    <View>
      <View style={[styles.grid, inset && styles.inset]} onLayout={(e) => setGridW(e.nativeEvent.layout.width - (inset ? SP.gutter * 2 : 0))}>
        {tile > 0
          ? rows.map((r) => {
              const on = r.tripId === current;
              return (
                <Pressable
                  key={r.tripId}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.title} 채팅방${r.pinned ? ', 고정됨' : ''}${r.preview ? `, ${r.preview}` : ''}`}
                  accessibilityHint="꾹 누르면 고정하거나 삭제할 수 있어요"
                  accessibilityState={{ selected: on }}
                  accessibilityActions={[{ name: 'longpress', label: '고정·삭제 메뉴' }]}
                  onAccessibilityAction={() => setMenuFor(r)}
                  onPress={() => onOpen(r.tripId)}
                  onLongPress={() => setMenuFor(r)}
                  delayLongPress={400}
                  style={({ pressed }) => [styles.tile, { width: tile, height: tile }, on && styles.tileOn, pressed && styles.pressed]}
                >
                  {/* 표지: 여행방 표지 사진(홈 카드와 같다). 없으면 연회색 바탕 가운데 핀과 지역 이름 */}
                  {r.cover ? (
                    <Image source={{ uri: r.cover }} resizeMode="cover" accessibilityIgnoresInvertColors style={StyleSheet.absoluteFill} />
                  ) : (
                    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.place]}>
                      <Icon name="pin" size={20} color="muted" stroke={1.6} />
                      <Txt v="mtTight" numberOfLines={1}>
                        {r.place}
                      </Txt>
                    </View>
                  )}
                  <View style={styles.tileTop}>
                    {r.pinned ? (
                      <View style={styles.chip} accessibilityLabel="고정됨">
                        <Icon name="pinlock" size={12} color="accentDeep" stroke={2} />
                      </View>
                    ) : (
                      <View />
                    )}
                    {r.hasMessage ? (
                      <View style={styles.chip}>
                        <Txt v="chip">{roomTime(r.at, now)}</Txt>
                      </View>
                    ) : null}
                  </View>
                  {/* 글은 아래 흰 판에(사진 위에서도 읽히게, 홈 카드와 같은 모양) */}
                  <View style={styles.panel}>
                    <Txt v="nm" numberOfLines={1}>
                      {r.title}
                    </Txt>
                    <Txt v="mtTight" numberOfLines={1}>
                      {r.preview || r.meta}
                    </Txt>
                  </View>
                </Pressable>
              );
            })
          : null}
      </View>

      <Sheet visible={!!menuFor} onClose={() => setMenuFor(undefined)} title={menuFor?.title}>
        <View style={styles.menu}>
          <Btn
            title={menuFor?.pinned ? '고정 해제' : '맨 위에 고정'}
            icon="pinlock"
            variant="quiet"
            onPress={() => {
              if (menuFor) {
                togglePin(menuFor.tripId);
                toast(menuFor.pinned ? '고정을 풀었어요' : '맨 위에 고정했어요');
              }
              setMenuFor(undefined);
            }}
          />
          <Btn
            title="채팅방 삭제"
            icon="trash"
            variant="quiet"
            onPress={() => {
              setDeleting(menuFor);
              setMenuFor(undefined);
            }}
          />
        </View>
      </Sheet>

      <ConfirmSheet
        visible={!!plan}
        title={plan?.title ?? ''}
        text={plan?.text ?? ''}
        confirmLabel={plan?.confirmLabel ?? '삭제'}
        onConfirm={() => {
          const target = deleting;
          setDeleting(undefined);
          if (!target || !plan) return;
          const r = dispatch(target.tripId, plan.op);
          if (!r.ok) {
            toast(r.reason ?? '삭제하지 못했어요', 'warn');
            return;
          }
          if (pinned?.includes(target.tripId)) togglePin(target.tripId);
          toast(plan.op.type === 'trip/delete' ? '채팅방과 여행방을 삭제했어요' : '채팅방을 삭제하고 여행방에서 나갔어요');
          onDeleted?.(target.tripId);
        }}
        onCancel={() => setDeleting(undefined)}
      />
    </View>
  );
}

/** 정사각형 칸 사이 간격 */
const TILE_GAP = SP.xl;

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP, paddingVertical: SP.m },
  inset: { paddingHorizontal: SP.gutter },
  tile: {
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: lineC.line,
    backgroundColor: surfaceC.soft,
    padding: SP.m,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  place: { alignItems: 'center', justifyContent: 'center', gap: SP.xs, paddingBottom: 40 },
  chip: {
    paddingHorizontal: SP.m,
    paddingVertical: 2,
    borderRadius: R.chip,
    borderWidth: 1,
    borderColor: lineC.line,
    backgroundColor: surfaceC.card,
  },
  panel: {
    paddingHorizontal: SP.l,
    paddingVertical: SP.m,
    gap: 2,
    borderRadius: R.btnSm,
    borderWidth: 1,
    borderColor: lineC.line,
    backgroundColor: surfaceC.card,
  },
  // 채팅 화면 시트에서 지금 보고 있는 방
  tileOn: { borderWidth: 2, borderColor: lineC.ink },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 18 },
  pressed: { opacity: 0.6 },
  menu: { gap: SP.m },
  empty: { paddingHorizontal: SP.gutter, paddingVertical: SP.section, gap: SP.s, alignItems: 'center' },
});
