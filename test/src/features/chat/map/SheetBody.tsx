import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { ChatSheetTab } from '../../../core/chatmap/mapView';
import type { MentionRow, RankRow } from '../../../core/chatmap/votes';
import { Avatar, Icon, IconBtn, Notice, Seg, SP, Txt, type SheetSnap } from '../../../ui';
import { MentionList } from './MentionList';
import { RankList } from './RankList';
import { budgetLine, topLine, whoCount, whoName, whoTitle, type SheetWho, type Voter } from './text';

export type SheetTab = ChatSheetTab;
export type { SheetWho };

/**
 * mini(64) 한 줄. 줄 전체가 버튼('투표 목록 열기')이고 누르면 peek로 연다(끌지 않는 길).
 * 멤버를 고르지 않았으면 '전체 투표'와 1위, 골랐으면 그 사람이 말한 장소 수다.
 */
export function SheetMini({ who, rank, onOpen }: { who: SheetWho | null; rank: RankRow[]; onOpen: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="투표 목록 열기" onPress={onOpen} hitSlop={{ bottom: SP.xs }} style={styles.mini}>
      {who ? (
        <>
          <Avatar name={who.nickname} index={who.index} />
          <View style={styles.grow}>
            <Txt v="nmSm" numberOfLines={1}>
              {whoTitle(who)}
            </Txt>
          </View>
        </>
      ) : (
        <>
          <Icon name="list" size={20} color="ink" stroke={1.8} />
          <Txt v="nmSm">전체 투표</Txt>
          <View style={styles.grow}>
            <Txt v="mtTight" numberOfLines={1}>
              {topLine(rank)}
            </Txt>
          </View>
        </>
      )}
      <Icon name="up" size={18} color="muted" stroke={2} />
    </Pressable>
  );
}

/**
 * peek·full의 머리 줄. 아바타 또는 아이콘, 제목·보조 줄, 펼치기/접기, 닫기(mini로 내리고 고른 멤버를 비운다).
 * 고른 멤버 제목은 이름 부분만 줄고 '{k}곳'은 줄지 않는다(360 폭에서 세 글자 이름이어도 수가 보이게).
 */
export function SheetHead({
  who,
  rank,
  snap,
  onExpand,
  onCollapse,
  onClose,
}: {
  who: SheetWho | null;
  rank: RankRow[];
  snap: SheetSnap;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}) {
  const full = snap === 'full';
  return (
    <View style={styles.head}>
      {who ? <Avatar name={who.nickname} index={who.index} /> : <Icon name="list" size={20} color="ink" stroke={1.8} />}
      <View style={styles.grow}>
        {who ? (
          <View style={styles.title} accessible accessibilityLabel={whoTitle(who)}>
            <View style={styles.shrink}>
              <Txt v="nm" numberOfLines={1}>
                {whoName(who)}
              </Txt>
            </View>
            <Txt v="nm">{whoCount(who)}</Txt>
          </View>
        ) : (
          <Txt v="nm" numberOfLines={1}>
            전체 투표
          </Txt>
        )}
        <Txt v="mtTight" numberOfLines={1}>
          {topLine(rank)}
        </Txt>
      </View>
      {full ? (
        <IconBtn icon="down" label="목록 접기" onPress={onCollapse} />
      ) : (
        <IconBtn icon="up" label="목록 펼치기" onPress={onExpand} />
      )}
      <IconBtn icon="x" label="닫기" onPress={onClose} />
    </View>
  );
}

/**
 * peek·full의 본문. 멤버를 골랐으면 [말한 장소 | 전체 투표] 탭, 오프라인·잠김 안내, 남은 표 줄, 목록 순이다.
 * 남은 표 줄은 투표할 수 있을 때만 보인다('남은 표 2/3', 다 쓰면 하나를 빼라는 안내).
 */
export function SheetContent({
  who,
  tab,
  onTab,
  mentions,
  rank,
  total,
  voterOf,
  online,
  locked,
  canVote,
  left,
  budget,
  isFull,
  focusSpotId,
  onToggle,
  onFocus,
}: {
  who: SheetWho | null;
  tab: SheetTab;
  onTab: (t: SheetTab) => void;
  mentions: MentionRow[];
  rank: RankRow[];
  total: number;
  voterOf: (memberId: string) => Voter;
  online: boolean;
  locked: boolean;
  canVote: boolean;
  /** 남은 표(0..budget) */
  left: number;
  budget: number;
  isFull: (spotId: string) => boolean;
  focusSpotId: string | null;
  onToggle: (spotId: string) => void;
  onFocus: (spotId: string) => void;
}) {
  const shown: SheetTab = who ? tab : 'rank';
  return (
    <View style={styles.content}>
      {who ? (
        <View style={styles.tabs}>
          <Seg<SheetTab>
            items={[
              { key: 'mentions', label: '말한 장소', a11yLabel: `말한 장소 ${who.count}곳` },
              { key: 'rank', label: '전체 투표' },
            ]}
            value={shown}
            onChange={onTab}
          />
        </View>
      ) : null}
      {locked ? (
        <View style={styles.notice}>
          <Notice icon="alert" text="여행이 끝나 투표할 수 없어요" />
        </View>
      ) : !online ? (
        <View style={styles.notice}>
          <Notice icon="alert" text="오프라인이에요. 투표는 연결되면 보내요" />
        </View>
      ) : null}
      {canVote ? (
        <View style={styles.budget} accessibilityLiveRegion="polite">
          <Txt v="mtTight" c={left > 0 ? 'muted' : 'accentStrong'} numberOfLines={2}>
            {budgetLine(left, budget)}
          </Txt>
        </View>
      ) : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
        {shown === 'mentions' ? (
          <MentionList rows={mentions} canVote={canVote} isFull={isFull} focusSpotId={focusSpotId} onToggle={onToggle} onFocus={onFocus} />
        ) : (
          <RankList
            rows={rank}
            total={total}
            voterOf={voterOf}
            canVote={canVote}
            isFull={isFull}
            focusSpotId={focusSpotId}
            onToggle={onToggle}
            onFocus={onFocus}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  mini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.m,
    minHeight: 40,
    paddingHorizontal: SP.gutter,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.m,
    paddingLeft: SP.gutter,
    paddingRight: SP.xl,
    paddingBottom: SP.s,
  },
  grow: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  shrink: {
    flexShrink: 1,
    minWidth: 0,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  tabs: {
    paddingHorizontal: SP.gutter,
  },
  notice: {
    paddingHorizontal: SP.gutter,
    paddingTop: SP.m,
  },
  budget: {
    paddingHorizontal: SP.gutter,
    paddingTop: SP.m,
  },
  scroll: {
    flex: 1,
  },
  scrollBody: {
    paddingHorizontal: SP.gutter,
  },
});
