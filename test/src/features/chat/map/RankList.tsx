import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { barRatio, type RankRow } from '../../../core/chatmap/votes';
import { Avatar, H, lineC, ProgressBar, SP, Txt } from '../../../ui';
import { VOTE_BUDGET } from '../../../core/chatmap/votes';
import { budgetNote, rankA11y, rankMeta, rankTone, type Voter } from './text';
import { VoteToggle } from './VoteToggle';

/** 투표자 아바타는 4명까지 그리고 나머지는 '+n' */
const STACK_MAX = 4;
/** 순위 칸 폭(‘12위’까지) */
const RANK_W = 36;

/**
 * 시트 '전체 투표' 탭(FR-405). 제외되지 않은 모든 장소를 여행방 전체 기준 순위로 보인다(지역은 줄 메타로만).
 * 줄: 순위(1~3위 강조), 이름, 투표자 아바타(최대 4), 막대(가장 많은 표 기준), '{지역} · {n}/{N}표', 투표 토글.
 * 동점은 같은 순위다. 순위는 '1위'처럼 읽혀 순번('1번')과 헷갈리지 않는다.
 * 투표자 아바타 색은 멤버 등록 순(왼쪽 열·채팅과 같은 색)이고 글자는 실제 닉네임이다. '나'는 읽는 이름에만 쓴다.
 */
export function RankList({
  rows,
  total,
  voterOf,
  canVote,
  isFull,
  focusSpotId,
  onToggle,
  onFocus,
}: {
  rows: RankRow[];
  total: number;
  voterOf: (memberId: string) => Voter;
  canVote: boolean;
  /** 표를 다 써서 이 장소에 켤 수 없는지 */
  isFull: (spotId: string) => boolean;
  focusSpotId: string | null;
  onToggle: (spotId: string) => void;
  onFocus: (spotId: string) => void;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <View>
      {rows.map((r, i) => {
        const meta = rankMeta(r, total);
        return (
          <View key={r.spotId} style={[styles.row, i === 0 ? null : styles.line]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={rankA11y(r, total)}
              accessibilityState={{ selected: focusSpotId === r.spotId }}
              onPress={() => onFocus(r.spotId)}
              style={styles.body}
            >
              <View style={styles.rank}>
                <Txt v="nmSm" c={rankTone(r.rank)}>{`${r.rank}위`}</Txt>
              </View>
              <View style={styles.main}>
                <View style={styles.head}>
                  <View style={styles.name}>
                    <Txt v="nm" numberOfLines={1}>
                      {r.name}
                    </Txt>
                  </View>
                  {r.voterIds.length > 0 ? <Voters voters={r.voterIds.map(voterOf)} /> : null}
                </View>
                <ProgressBar value={barRatio(r.count, max)} />
                <Txt v="mtTight">{meta}</Txt>
              </View>
            </Pressable>
            <VoteToggle name={r.name} on={r.mine} disabled={!canVote} full={isFull(r.spotId)} onPress={() => onToggle(r.spotId)} />
          </View>
        );
      })}
      <View style={styles.note}>
        <Txt v="mtTight">{budgetNote(VOTE_BUDGET)}</Txt>
      </View>
    </View>
  );
}

/** 투표자 겹친 아바타(최대 4명, 나머지 '+n'). 색은 줄 안 자리가 아니라 멤버 순서를 따른다 */
function Voters({ voters }: { voters: Voter[] }) {
  const shown = voters.slice(0, STACK_MAX);
  const rest = voters.length - shown.length;
  const names = shown.map((v) => v.label).join(', ');
  return (
    <View accessible accessibilityLabel={rest > 0 ? `${names} 외 ${rest}명` : names} style={styles.voters}>
      {shown.map((v, i) => (
        <Avatar key={`${v.label}-${i}`} name={v.nickname} index={v.index} style={i > 0 ? styles.overlap : undefined} />
      ))}
      {rest > 0 ? (
        <View style={styles.more}>
          <Txt v="chip" c="muted">{`+${rest}`}</Txt>
        </View>
      ) : null}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.m,
  },
  rank: {
    width: RANK_W,
  },
  main: {
    flex: 1,
    minWidth: 0,
    gap: SP.xs,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.m,
  },
  name: {
    flexShrink: 1,
    minWidth: 0,
  },
  voters: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overlap: {
    marginLeft: H.avatarOverlap,
  },
  more: {
    marginLeft: SP.xs,
  },
  note: {
    paddingTop: SP.l,
    paddingBottom: SP.xxl,
  },
});
