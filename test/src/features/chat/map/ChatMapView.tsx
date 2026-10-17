import React, { memo, useEffect, useMemo, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { MapCanvas } from '../../../components/map/MapCanvas';
import type { ChatArea } from '../../../core/chatmap/areas';
import { chatMapInput, chatMapLayout, type ChatMapEvent, type ChatMapState } from '../../../core/chatmap/mapView';
import { mentionsOf, rankSpots, railOrder, VOTE_BUDGET, voteBlocked, voteCounts, votesLeft } from '../../../core/chatmap/votes';
import { activeMembers } from '../../../core/group';
import { isEditLocked } from '../../../core/ops';
import type { MapPolylineInput } from '../../../core/map/layout';
import { useNow } from '../../../services/clock';
import { myMemberId } from '../../../store/trips';
import { useUi } from '../../../store/ui';
import type { Trip } from '../../../types';
import { Empty, PeekSheet, SHEET_MINI_H, type SheetSnap } from '../../../ui';
import { memberIndex } from '../view';
import { canVote as canVoteNow, toggleVote } from './actions';
import { MemberRail, type RailMember } from './MemberRail';
import { SheetContent, SheetHead, SheetMini } from './SheetBody';
import type { SheetWho, Voter } from './text';

const SNAPS: readonly SheetSnap[] = ['mini', 'peek', 'full'];
/** 선이 없는 지도. 매번 새 배열을 넘기면 SVG 지도가 그릴 때마다 배치를 다시 계산한다 */
const NO_LINES: MapPolylineInput[] = [];

/**
 * 채팅방 지도(FR-405, 명세 밖 추가). 채팅에서 나온 장소를 지도에 모으고, 지역·멤버로 거르고, 장소마다 한 표씩 준다.
 * - 바깥 View가 onLayout으로 크기를 재고 높이가 0보다 클 때만 저장한다(숨긴 채 유지할 때 지도를 다시 부르지 않게).
 * - 지도는 MapCanvas(components/map)만 쓴다. 키가 있으면 카카오, 없으면 SVG 기본 지도다. 지도 SDK를 직접 부르지 않는다.
 * - 핀은 '{n}표' 라벨과 표 수에 따른 크기다. 핀을 누르면 그 지역을 고른다(칩을 누른 것과 같다).
 *   이미 고른 지역 안의 핀을 누르면 지역을 풀지 않고 그 핀에 맞춘다(시트는 peek).
 * - 배치(시트 폭·왼쪽 열 크기·지도 아래 덮임)는 core/chatmap/mapView.chatMapLayout이 정한다. 넓은 화면의 시트는
 *   오른쪽에 붙고 왼쪽 열·'전체 보기'를 가리지 않는다.
 * - 화면(ChatScreen)은 입력할 때마다 다시 그려지므로 memo로 감싼다(받는 값은 모두 안정적이다).
 * - 왼쪽 열(MemberRail)은 지도 좌표가 아니라 화면 왼쪽에 둔다(위치 공유 없음).
 * - 시트는 공용 PeekSheet(mini·peek·full)다. 끌기 말고도 mini 줄 버튼, 펼치기·접기, 닫기, 손잡이 탭·조절로 같은 상태에 닿는다.
 * - 안드로이드 뒤로는 시트가 mini보다 위면 먼저 mini로 내린다.
 * 상태(지역·멤버·탭·스냅·포커스)는 화면(ChatScreen)이 core/chatmap/mapView.chatMapStep으로 들고 있다. 칩 줄이 지도 밖에 있어서다.
 */
export const ChatMapView = memo(function ChatMapView({
  trip,
  areas,
  areaBySpot,
  state,
  send,
  online,
  visible,
  wide,
}: {
  trip: Trip;
  areas: readonly ChatArea[];
  areaBySpot: Readonly<Record<string, string>>;
  state: ChatMapState;
  send: (e: ChatMapEvent) => void;
  online: boolean;
  visible: boolean;
  wide: boolean;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [sheetH, setSheetH] = useState(SHEET_MINI_H);
  const now = useNow();
  // memo라 화면이 다시 그려져도 여기는 그대로다. '나'(시연의 보내는 사람 바꾸기)가 바뀌면 직접 다시 그린다
  const actingAs = useUi((s) => s.actingAs[trip.id]);
  void actingAs;
  const { selArea, selMember, tab, snap, focusSpotId } = state;

  const active = useMemo(() => activeMembers(trip), [trip]);
  const me = myMemberId(trip);
  const locked = isEditLocked(trip, now);
  const canVote = canVoteNow(trip, now);
  const live = useMemo(() => trip.spots.filter((s) => !s.removedByUser), [trip]);
  const counts = useMemo(() => voteCounts(trip.spots, active), [trip, active]);
  const rank = useMemo(() => rankSpots(trip.spots, areaBySpot, active, me), [trip, areaBySpot, active, me]);
  // 고른 지역 키는 지금 지역 목록에서 찾은 것만 쓴다(데이터가 바뀌어 사라진 키로 모든 핀을 흐리지 않게)
  const area = selArea ? areas.find((a) => a.key === selArea) : undefined;
  const areaKey = area?.key ?? null;
  const member = selMember ? active.find((m) => m.id === selMember) : undefined;
  const mentions = useMemo(
    () => (member ? mentionsOf(trip, member.id, areaBySpot, areaKey, me) : []),
    [trip, member, areaBySpot, areaKey, me],
  );
  const input = useMemo(
    () => chatMapInput(trip.spots, areaBySpot, counts, { area: areaKey, member: member?.id, focusSpotId }),
    [trip, areaBySpot, counts, areaKey, member, focusSpotId],
  );

  const rail: RailMember[] = useMemo(
    () =>
      railOrder(active, area ? area.pickerIds : null).map((m) => {
        const said = live.filter((s) => s.proposals.some((p) => p.memberId === m.id));
        return {
          id: m.id,
          label: m.id === me ? '나' : m.nickname,
          nickname: m.nickname,
          index: memberIndex(trip.members, m.id),
          count: said.length,
          areaPlaces: area ? said.filter((s) => areaBySpot[s.id] === area.key).map((s) => s.name) : undefined,
        };
      }),
    [active, area, live, me, areaBySpot, trip.members],
  );
  const who: SheetWho | null = member
    ? {
        id: member.id,
        nickname: member.nickname,
        index: memberIndex(trip.members, member.id),
        mine: member.id === me,
        count: rail.find((r) => r.id === member.id)?.count ?? 0,
      }
    : null;
  const voterOf = (id: string): Voter => {
    const m = active.find((x) => x.id === id);
    const nickname = m?.nickname ?? '';
    return { nickname, index: memberIndex(trip.members, id), label: id === me ? '나' : nickname };
  };

  // 안드로이드 뒤로: 시트가 펼쳐져 있으면 먼저 mini로 내린다
  useEffect(() => {
    if (Platform.OS !== 'android' || !visible || snap === 'mini') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      send({ t: 'close' });
      return true;
    });
    return () => sub.remove();
  }, [visible, snap, send]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (height > 0 && (width !== size.w || height !== size.h)) setSize({ w: width, h: height });
  };

  if (live.length === 0) {
    return (
      <View style={styles.fill} onLayout={onLayout}>
        <Empty icon="pin" title="아직 채팅에서 나온 장소가 없어요" text="장소 이름을 말하면 여기 모여요" />
      </View>
    );
  }

  const left = me ? votesLeft(trip, me) : 0;
  const isFull = (spotId: string) => {
    if (!me || left > 0) return false;
    const spot = trip.spots.find((s) => s.id === spotId);
    return !!spot && voteBlocked(trip.spots, spot, me);
  };
  const toggle = (spotId: string) => {
    const spot = trip.spots.find((s) => s.id === spotId);
    if (spot) toggleVote(trip.id, spot);
  };
  const lay = chatMapLayout(size.w, size.h, sheetH, wide);
  const pressPin = (spotId: string) => {
    const key = areaBySpot[spotId];
    if (!key) return;
    // 고른 지역 안의 핀은 지역을 풀지 않고 그 핀에 맞춘다(무엇인지 보려고 누른 것이다). 칩은 그대로 토글이다
    if (key === areaKey) send({ t: 'focus', spotId });
    else send({ t: 'area', key });
  };

  return (
    <View style={styles.fill} onLayout={onLayout}>
      {size.h > 0 ? (
        <MapCanvas
          flat
          height={size.h}
          markers={input.markers}
          fitTo={input.fitTo}
          polylines={NO_LINES}
          onMarkerPress={pressPin}
          overlayBottom={lay.overlayBottom}
        >
          <MemberRail
            members={rail}
            total={active.length}
            areaName={area?.name ?? null}
            pickerIds={area ? area.pickerIds : null}
            selected={member?.id ?? null}
            noSelection={!area && !member}
            tagMaxWidth={lay.tagMaxWidth}
            maxHeight={lay.railMaxHeight}
            onPress={(id) => send({ t: 'member', id })}
          />
        </MapCanvas>
      ) : null}
      <PeekSheet
        snap={snap}
        onSnap={(s) => send({ t: 'snap', snap: s })}
        snaps={SNAPS}
        areaHeight={size.h}
        gripLabel="투표 목록"
        onSettle={setSheetH}
        style={wide ? { left: lay.sheetLeft } : undefined}
        mini={<SheetMini who={who} rank={rank} onOpen={() => send({ t: 'snap', snap: 'peek' })} />}
        head={
          <SheetHead
            who={who}
            rank={rank}
            snap={snap}
            onExpand={() => send({ t: 'snap', snap: 'full' })}
            onCollapse={() => send({ t: 'snap', snap: 'peek' })}
            onClose={() => send({ t: 'close' })}
          />
        }
      >
        <SheetContent
          who={who}
          tab={tab}
          onTab={(t) => send({ t: 'tab', tab: t })}
          mentions={mentions}
          rank={rank}
          total={active.length}
          voterOf={voterOf}
          online={online}
          locked={locked}
          canVote={canVote}
          left={left}
          budget={VOTE_BUDGET}
          isFull={isFull}
          focusSpotId={focusSpotId}
          onToggle={toggle}
          onFocus={(spotId) => send({ t: 'focus', spotId })}
        />
      </PeekSheet>
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
  },
});
