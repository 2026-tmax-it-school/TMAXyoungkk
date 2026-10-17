import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MentionRow } from '../../../core/chatmap/votes';
import { H, lineC, SP, Txt } from '../../../ui';
import { VoteToggle } from './VoteToggle';

/**
 * 시트 '말한 장소' 탭(FR-405). 고른 멤버가 말한 장소를 한 스팟에 한 줄로 보인다(고른 지역이 먼저).
 * 줄: 장소 이름, '{지역} · {n}표', 채팅 인용(2줄) 또는 '직접 추가했어요', 오른쪽 투표 토글.
 * 줄 본문을 누르면 그 핀에 지도를 맞춘다(토글은 따로 눌린다).
 */
export function MentionList({
  rows,
  canVote,
  isFull,
  focusSpotId,
  onToggle,
  onFocus,
}: {
  rows: MentionRow[];
  canVote: boolean;
  /** 표를 다 써서 이 장소에 켤 수 없는지 */
  isFull: (spotId: string) => boolean;
  focusSpotId: string | null;
  onToggle: (spotId: string) => void;
  onFocus: (spotId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Txt v="mt">아직 말한 장소가 없어요</Txt>
      </View>
    );
  }
  return (
    <View>
      {rows.map((r, i) => {
        const meta = r.areaName ? `${r.areaName} · ${r.count}표` : `${r.count}표`;
        return (
          <View key={r.spotId} style={[styles.row, i === 0 ? null : styles.line]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${r.name}, ${meta}, 지도에서 보기`}
              accessibilityState={{ selected: focusSpotId === r.spotId }}
              onPress={() => onFocus(r.spotId)}
              style={styles.body}
            >
              <Txt v="nm" numberOfLines={1}>
                {r.name}
              </Txt>
              <Txt v="mtTight">{meta}</Txt>
              {r.quote ? (
                <Txt v="mt" numberOfLines={2}>
                  {`“${r.quote}”`}
                </Txt>
              ) : (
                <Txt v="mt">직접 추가했어요</Txt>
              )}
            </Pressable>
            <VoteToggle name={r.name} on={r.mine} disabled={!canVote} full={isFull(r.spotId)} onPress={() => onToggle(r.spotId)} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.l,
    paddingVertical: SP.l,
  },
  line: {
    borderTopWidth: 1,
    borderTopColor: lineC.line,
  },
  body: {
    flex: 1,
    minWidth: 0,
    minHeight: H.touch,
    gap: 2,
    justifyContent: 'center',
  },
  empty: {
    paddingVertical: SP.xxl,
  },
});
