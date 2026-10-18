import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { myMemberId, useMyTrips, useTrips } from '../../../store/trips';
import { useNow } from '../../../services/clock';
import { useUi } from '../../../store/ui';
import { Btn, ConfirmSheet, Icon, lineC, R, Sheet, SP, surfaceC, Txt } from '../../../ui';
import { chatRooms, deleteRoomPlan, filterRooms, roomTime, type ChatRoomRow } from '../rooms';

/**
 * 채팅방 목록(내 여행방마다 채팅방 하나). 채팅 목록 화면(ChatList)과 채팅 화면 머리의 방 바꾸기 시트에서 같이 쓴다.
 * - 메신저 받은편지함형 목록(2026-10-17 사용자 요청, 정사각형 칸 대신): 왼쪽 둥근 표지(없으면 핀), 오른쪽에 '방 이름 · 지역'과 시각,
 *   마지막 말(두 줄까지), '기간 · 멤버 N명'. 줄 사이는 구분선
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

  return (
    <View>
      {/* 메신저 받은편지함형 목록(2026-10-17): 둥근 표지 · '방 이름 · 지역' + 시각 · 마지막 말 · 기간과 멤버 수, 줄 사이 구분선 */}
      <View style={inset && styles.inset}>
        {rows.map((r, i) => {
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
              style={({ pressed }) => [styles.row, i < rows.length - 1 && styles.rowLine, on && styles.rowOn, pressed && styles.pressed]}
            >
              <View style={styles.avatar}>
                {r.cover ? (
                  <Image source={{ uri: r.cover }} resizeMode="cover" accessibilityIgnoresInvertColors style={StyleSheet.absoluteFill} />
                ) : (
                  <Icon name="pin" size={20} color="muted" stroke={1.6} />
                )}
              </View>
              <View style={styles.body}>
                <View style={styles.top}>
                  <View style={styles.grow}>
                    <Txt v="mtTight" numberOfLines={1}>{`${r.title} · ${r.place}`}</Txt>
                  </View>
                  {r.pinned ? <Icon name="pinlock" size={12} color="accentDeep" stroke={2} /> : null}
                  {r.hasMessage ? <Txt v="mtTight">{roomTime(r.at, now)}</Txt> : null}
                </View>
                {r.preview ? (
                  <Txt v="nm" numberOfLines={2}>
                    {r.preview}
                  </Txt>
                ) : (
                  <Txt v="mt">{r.meta === '채팅 메모' ? '아직 메모가 없어요' : '아직 대화가 없어요'}</Txt>
                )}
                <Txt v="mtTight" numberOfLines={1}>{`${r.dates} · ${r.meta}`}</Txt>
              </View>
            </Pressable>
          );
        })}
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

/** 목록 줄 왼쪽 둥근 표지 지름 */
const AVATAR = 52;

const styles = StyleSheet.create({
  inset: { paddingHorizontal: SP.gutter },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.l, paddingVertical: SP.xl },
  rowLine: { borderBottomWidth: 1, borderBottomColor: lineC.line },
  // 채팅 화면 시트에서 지금 보고 있는 방
  rowOn: { backgroundColor: surfaceC.soft },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: R.chip,
    overflow: 'hidden',
    backgroundColor: surfaceC.off,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: SP.s },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  menu: { gap: SP.m },
  empty: { paddingHorizontal: SP.gutter, paddingVertical: SP.section, gap: SP.s, alignItems: 'center' },
});
