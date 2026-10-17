import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar, H, lineC, MapPill, OPACITY, SP } from '../../../ui';

export interface RailMember {
  id: string;
  /** 보이는 이름. 나는 '나' */
  label: string;
  /** 아바타 첫 글자에 쓰는 실제 닉네임 */
  nickname: string;
  /** 아바타 색 순서(멤버 등록 순, 채팅과 같다) */
  index: number;
  /** 말한 장소 수(제외 스팟 빼고) */
  count: number;
  /** 고른 지역에서 이 사람이 말한 장소 이름(지역을 고른 경우만) */
  areaPlaces?: string[];
}

/**
 * 채팅방 지도 왼쪽 열(FR-405). 활성 멤버 전부를 늘 보인다. 프로필은 지도 좌표 위에 두지 않는다(위치 공유 없음).
 * - 맨 위 제목 알약: '채팅방 {N}명' 또는 '{지역} 고른 사람 {k}/{N}'. 아무것도 고르지 않았을 때만 아래에 안내 한 줄.
 * - 한 줄: 큰 아바타(44)와 이름표. 지역을 고르기 전 이름표는 '{이름} · {k}곳'(muted)이다.
 * - 지역을 고르면 고른 사람이 위로 와서 '{이름} · {그 지역 장소들}'을 보이고, 나머지는 흐려지고 이름표가 없지만 누를 수 있다.
 * - 고른 멤버는 잉크 2px 고리를 두른다. 누르면 그 사람이 말한 장소를 시트에 연다(다시 누르면 닫는다).
 * - maxHeight는 제목 알약과 목록을 합친 열 전체 높이다(core/chatmap/mapView.railLayout: 시트와 '전체 보기' 자리를 뺀다).
 *   넘치면 목록만 줄어 스크롤한다.
 * - 열·목록 상자는 box-none이라 줄(아바타·이름표) 밖의 빈 곳은 지도가 받는다(핀 누르기·지도 끌기).
 *   pointerEvents는 StyleSheet로 준다(RNW 0.21은 인라인 pointerEvents를 버린다).
 */
export function MemberRail({
  members,
  total,
  areaName,
  pickerIds,
  selected,
  noSelection,
  tagMaxWidth,
  maxHeight,
  onPress,
}: {
  members: RailMember[];
  total: number;
  areaName: string | null;
  pickerIds: readonly string[] | null;
  selected: string | null;
  noSelection: boolean;
  tagMaxWidth: number;
  maxHeight: number;
  onPress: (id: string) => void;
}) {
  const title = areaName ? `${areaName} 고른 사람 ${pickerIds?.length ?? 0}/${total}` : `채팅방 ${total}명`;
  return (
    <View style={[styles.rail, { maxHeight }]}>
      <MapPill
        label={title}
        sub={noSelection ? '지역을 고르면 고른 사람이 위로 와요' : undefined}
        numberOfLines={1}
        style={{ maxWidth: tagMaxWidth + H.avatarLg + SP.m }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {members.map((m) => {
          const picked = !pickerIds || pickerIds.includes(m.id);
          const on = selected === m.id;
          const tag = !pickerIds
            ? `${m.label} · ${m.count}곳`
            : picked
              ? `${m.label} · ${(m.areaPlaces ?? []).join(', ')}`
              : undefined;
          return (
            <Pressable
              key={m.id}
              accessibilityRole="button"
              accessibilityLabel={`${m.label}, 말한 장소 ${m.count}곳 보기`}
              accessibilityState={{ selected: on }}
              onPress={() => onPress(m.id)}
              style={[styles.row, picked ? null : styles.dim]}
            >
              <View style={[styles.ring, on ? styles.ringOn : null]}>
                <Avatar name={m.nickname} index={m.index} size="lg" />
              </View>
              {tag ? <MapPill label={tag} muted={!pickerIds} numberOfLines={1} style={{ maxWidth: tagMaxWidth }} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const RING = 2;

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    left: SP.m,
    top: SP.m,
    gap: SP.m,
    alignItems: 'flex-start',
    pointerEvents: 'box-none',
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
    pointerEvents: 'box-none',
  },
  list: {
    gap: SP.s,
    paddingBottom: SP.xs,
    alignItems: 'flex-start',
    pointerEvents: 'box-none',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SP.m,
    minHeight: H.touch,
  },
  dim: {
    opacity: OPACITY.dim,
  },
  ring: {
    borderRadius: (H.avatarLg + RING * 2) / 2,
    borderWidth: RING,
    borderColor: 'transparent',
  },
  ringOn: {
    borderColor: lineC.ink,
  },
});
