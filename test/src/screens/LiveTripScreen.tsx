import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import type { Place, TrackPoint } from '../types';
import type { MapDotInput } from '../core/map/layout';
import { liveDayFromTrip } from '../core/live/context';
import { etaView, jumpTargets, pickLiveDate, type LiveLogLine } from '../core/live/session';
import { isHost } from '../core/group';
import { isEnded, tripStatus } from '../core/tripStatus';
import { kstDate, kstHHMM } from '../core/util';
import { MapCanvas } from '../components/map/MapCanvas';
import { DayTimeline } from '../features/schedule/components/DayTimeline';
import { daySegLabel, dayTitle } from '../features/schedule/view';
import { BG_BLOCK_TEXT, BG_NOTICE_HIDDEN_TEXT } from '../features/live/bgRecordText';
import { BgRecordCard } from '../features/live/components/BgRecordCard';
import { FreeTimeCard } from '../features/live/components/FreeTimeCard';
import { LiveNowCard } from '../features/live/components/LiveNowCard';
import { ProposalSheet } from '../features/live/components/ProposalSheet';
import { SIM_BANNER_TEXT } from '../features/live/components/SimBanner';
import { SimControls } from '../features/live/components/SimControls';
import '../features/live/photoBridge';
import { TripEditSheet } from '../features/trip/components/TripEditSheet';
import { useDayMap } from '../features/live/useDayMap';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { appClock, useNow } from '../services/clock';
import { backgroundRecordBlock, useLive, useSimBanner, useVisitStatuses, type LiveState } from '../store/live';
import { useSession } from '../store/session';
import { myMemberId, usePlan, useTripDoc, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Body,
  Btn,
  Card,
  Chip,
  type ChipTone,
  Col,
  ConfirmSheet,
  Empty,
  Foot,
  H,
  Header,
  Icon,
  type IconName,
  ListRow,
  NotFound,
  Notice,
  Row,
  Screen,
  Seg,
  Sheet,
  SP,
  TextLink,
  Txt,
} from '../ui';

/**
 * 19 여행 진행 · 시뮬레이터(FR-601~604, WP5 소유).
 * 현재 위치(로즈 점, 정확도 50m 초과면 흐린 원), 도착 감지와 수동 취소, 지연 조정안 시트, 빈 시간 추천, 오늘 타임라인.
 * 실제로 경주를 돌아다닐 수 없어 여행 시뮬레이터(시각 가속 재생)로 시연한다.
 * 판정은 core/live, 상태와 효과 적용은 store/live가 한다. 여기서는 보여주기만 한다.
 *
 * 배치(UX 점검 B8):
 * - 머리말은 작게(eyebrow '여행 진행 · 여행방 이름', 제목은 날짜), 뒤로는 useBack('Map')이다. 여행방이 없으면 NotFound.
 * - 진행 중에는 머리말 아래에 높이가 고정된 상태 줄 하나를 둔다. 왼쪽은 진행 방식 칩, 오른쪽은 지금 상태 칩 하나이고,
 *   누르면 설명 시트가 열린다. 안내 상자를 쌓지 않는다. 경고는 'GPS 신호 약함' 한 줄뿐이다.
 * - 시작 전: 날짜 Seg 아래, 지도 위에 '어떻게 진행할까요' 줄 셋(기기 위치, 수동, 시뮬레이터). 오늘이 여행 기간 안이면
 *   기기 위치가, 아니면 시뮬레이터가 맨 위다. 기기 위치가 꺼진 채 누르면 확인 시트를 거쳐 설정을 먼저 켜고 시작한다
 *   (끈 채로 시작하면 store/live invalidReason이 진행을 바로 끝낸다). 시작 전에는 시뮬레이터 조작 카드 대신 접힌 프리셋 줄만 둔다.
 * - 진행 중: 본문 맨 위에 지금 카드, 주 행동([구간 안내], [도착 처리])은 아래 Foot이다. Foot 맨 위 한 줄 '다음 · {스팟}'이
 *   도착 처리가 어느 스팟에 붙는지 늘 보인다(도착해 머무는 중이면 지금 카드 제목은 머무는 스팟이라서. 높이가 바뀌지 않게 늘 둔다).
 *   그 아래 지도(200)와 '지도 크게 보기',
 *   조정안으로 뺀 스팟, 빈 시간 추천, 시간표, 시뮬레이터 조작, 백그라운드 기록, 진행 기록, '기록 보기', 끝내기 순이다.
 *   끝내기는 확인 시트를 한 번 거친다.
 * 백그라운드 동선 기록(기본 꺼짐)은 기기 위치를 쓸 때만 보인다. 시작 전에는 진행 방식 아래, 진행 중에는 진행 기록 위에 둔다.
 * 받기가 돌고 있으면 기기 위치 설정과 상관없이 보여 언제든 끌 수 있게 한다.
 * 앱이 화면 밖에 있으면 시계 갱신을 1분으로 늦춘다(백그라운드 기록 중에도 매초 다시 그리지 않게).
 */

const NO_POINTS: TrackPoint[] = [];
const DOT_MAX = 240;
const MAP_H = 200;

type StartKind = 'device' | 'manual' | 'sim';

/** 상태 줄 오른쪽 칩 하나(지금 가장 중요한 상태)와 설명 시트 줄 */
function liveStatus(
  live: Pick<LiveState, 'mode' | 'requested' | 'shadow' | 'accuracyUnknown' | 'background' | 'bgActive' | 'sim'>,
  sim: boolean,
): { mode: string; modeIcon: IconName; state: { text: string; tone: ChipTone }; lines: string[] } {
  const denied = live.mode === 'manual' && live.requested !== 'manual';
  const mode = sim ? SIM_BANNER_TEXT : live.mode === 'device' ? '기기 위치' : '수동 진행';
  const modeIcon: IconName = sim ? 'play' : live.mode === 'device' ? 'locate' : 'check';
  const lines: string[] = [];
  if (sim) lines.push('여행 시뮬레이터가 시각을 빠르게 돌려 재생하고 있어요. 지도의 위치는 실제 위치가 아니에요.');
  if (live.mode === 'device') lines.push('기기 위치로 도착을 자동으로 기록해요. 위치는 이 기기에서만 써요.');
  if (live.mode === 'manual') {
    lines.push(
      denied
        ? '위치 권한이 없어 도착을 버튼으로 기록해요. 스팟에 닿으면 도착 처리를 눌러 주세요.'
        : '도착을 버튼으로 기록해요. 스팟에 닿으면 도착 처리를 눌러 주세요.',
    );
  }
  if (live.shadow) lines.push('GPS 신호가 약해요. 정확도가 50m를 넘는 위치는 도착 판정에서 빼고, 신호가 돌아오면 이어서 봐요.');
  if (live.mode === 'device' && live.accuracyUnknown) {
    lines.push('위치 정확도를 알 수 없어 도착을 자동으로 판정하지 않아요. 도착하면 도착 처리를 눌러 주세요.');
  }
  const paused = live.background && !live.bgActive;
  if (paused) lines.push('앱이 화면 밖에 있어 위치 확인과 재생을 멈췄어요.');

  const state: { text: string; tone: ChipTone } = live.shadow
    ? { text: '신호 약함', tone: 'warn' }
    : paused
      ? { text: '화면 밖 멈춤', tone: 'line' }
      : live.mode === 'device' && live.accuracyUnknown
        ? { text: '자동 도착 꺼짐', tone: 'line' }
        : denied
          ? { text: '위치 권한 없음', tone: 'line' }
          : sim && !live.sim.playing
            ? { text: '멈춤', tone: 'line' }
            : { text: sim ? '재생 중' : '진행 중', tone: 'ok' };
  return { mode, modeIcon, state, lines };
}

export default function LiveTripScreen({ navigation, route }: RootScreenProps<'LiveTrip'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const live = useLive();
  const now = useNow(live.background ? 60_000 : 1000);
  const useDevice = useSession((s) => s.useDeviceLocation);
  const back = useBack('Map');
  const [picked, setPicked] = useState<string | undefined>(route.params.date);
  /** 접어 둔 조정안 id(바탕을 눌러 닫은 경우). 거절과 다르다 */
  const [hiddenProposal, setHiddenProposal] = useState<string | undefined>(undefined);
  const [askDevice, setAskDevice] = useState(false);
  const [askStop, setAskStop] = useState(false);
  const [editing, setEditing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  // 렌더마다 읽는다. 이전 설정으로 만든 빌드라는 것을 켜거나 진행을 시작하다 알면 그 뒤로 '켤 수 없음'이 된다.
  const bgBlock = backgroundRecordBlock();
  const [bgBusy, setBgBusy] = useState(false);

  const running = live.mode !== 'off' && live.tripId === tripId;
  const date = running && live.date ? live.date : trip ? pickLiveDate(trip, plan, now, picked) : '';
  const map = useDayMap(trip, plan, date || 'all');
  const statuses = useVisitStatuses(tripId, date);
  const simBanner = useSimBanner(tripId, date);
  const day = plan?.days.find((d) => d.date === date);
  const liveDay = useMemo(() => (trip && day ? liveDayFromTrip(trip, day) : undefined), [trip, day]);
  const points = (running ? live.track[tripId]?.[date] : undefined) ?? NO_POINTS;
  const dots = useMemo<MapDotInput[]>(
    () => points.slice(-DOT_MAX).map((p, i) => ({ id: `t${i}`, coord: p.coord, tone: 'faint' as const })),
    [points],
  );

  useEffect(() => {
    useLive.getState().pruneTrack(appClock().now());
  }, []);

  if (!trip) {
    return (
      <Screen>
        <Header size="sm" back={back} title="여행 진행" />
        <Body>
          <NotFound title="여행방을 찾을 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
        </Body>
      </Screen>
    );
  }

  const L = useLive.getState();
  const timing = running ? live.timing : undefined;
  const eta = timing ? etaView(timing) : undefined;
  const current = running && live.arrival.visitId && live.arrival.spotId ? live.arrival : undefined;
  const currentName = current ? trip.spots.find((s) => s.id === current.spotId)?.name : undefined;
  const nextLeg = timing ? map.legs.find((l) => l.toId === timing.spotId) : undefined;
  const proposal = running ? live.proposals[0] : undefined;
  const proposalHidden = !!proposal && hiddenProposal === proposal.id;
  const proposalName = proposal ? live.proposalInfo[proposal.id]?.name : undefined;
  const delayRemoved = trip.spots.filter((s) => s.removedByUser && s.removedReason === 'delay');
  const ended = isEnded(trip, now);
  const jumps = jumpTargets(trip, liveDay, timing, now);
  const hasItems = !!day && day.items.length > 0;
  const dateItems = (plan?.days ?? [])
    .filter((d) => d.items.length > 0)
    .map((d) => ({ key: d.date, label: daySegLabel(d.date), a11yLabel: dayTitle(d.date) }));
  const today = !!date && kstDate(now) === date;
  /** 수동 진행이거나 정확도를 모르면 도착은 버튼으로 기록한다(도착 처리가 주 행동) */
  const manualArrive = live.mode === 'manual' || live.accuracyUnknown;
  const status = running ? liveStatus(live, simBanner) : undefined;

  const startSim = () => {
    L.start(tripId, date, 'sim');
    L.play();
  };
  /** 기기 위치로 시작. 설정을 먼저 켜고 그다음 시작한다(끈 채로 시작하면 invalidReason이 진행을 바로 끝낸다) */
  const beginDevice = () => {
    setAskDevice(false);
    if (!useSession.getState().useDeviceLocation) useSession.getState().setUseDeviceLocation(true);
    L.start(tripId, date, 'device');
  };
  const pickDevice = () => (useDevice ? beginDevice() : setAskDevice(true));
  const toggleBg = async (on: boolean) => {
    setBgBusy(true);
    try {
      const r = await L.setBgRecord(on);
      if (!r.ok) useUi.getState().showToast(BG_BLOCK_TEXT[r.reason], 'warn');
      else if (r.noticeHidden) useUi.getState().showToast(BG_NOTICE_HIDDEN_TEXT);
    } finally {
      setBgBusy(false);
    }
  };
  // 기기 위치를 쓸 때만 의미가 있다(시뮬레이터·수동 진행에는 영향 없음). 받기가 돌고 있으면 끌 수 있게 늘 보인다.
  const showBg = hasItems && (useDevice || live.bgActive) && (!running || live.mode === 'device');
  const bgCard = showBg ? (
    <BgRecordCard
      on={live.bgRecord}
      active={live.bgActive}
      block={bgBlock}
      running={running}
      today={today}
      busy={bgBusy}
      onChange={(on) => void toggleBg(on)}
    />
  ) : null;
  const restore = (spotId: string, name: string) => {
    const r = useTrips.getState().dispatch(tripId, { type: 'spot/restore', spotId });
    if (r.ok) useUi.getState().showToast(`${name}을(를) 고정으로 되돌렸어요`);
  };
  const openRecord = () => navigation.navigate('Journal', { tripId, date });
  const openBigMap = () => {
    useUi.getState().setCurrentTrip(tripId);
    navigation.navigate('Main', { screen: 'Map', params: { date } });
  };
  /**
   * 빈 시간 추천 장소를 카카오맵으로 연다(13의 '카카오맵으로 열기'와 같은 목적지 링크). 링크에는 목적지 이름과 좌표만 들어간다.
   * 도보 길찾기 링크(link/by/walk)는 출발 좌표를 넣어야 해서 쓰지 않는다('위치는 이 기기에서만 써요'를 지킨다). 도보는 카카오맵에서 고른다.
   */
  const openInKakao = (p: Place) => {
    const url = `https://map.kakao.com/link/to/${encodeURIComponent(p.name)},${p.coord.latitude},${p.coord.longitude}`;
    Linking.openURL(url).catch(() => useUi.getState().showToast('카카오맵을 열지 못했어요', 'warn'));
  };

  // 시작 줄 순서: 오늘이 여행 기간 안이면 기기 위치가, 아니면 시뮬레이터가 맨 위다
  const startOrder: StartKind[] = tripStatus(trip, now) === 'ongoing' ? ['device', 'manual', 'sim'] : ['sim', 'device', 'manual'];
  const startRow = (k: StartKind, first: boolean) => {
    if (k === 'device') {
      return (
        <ListRow
          key={k}
          first={first}
          icon="locate"
          label="기기 위치로 진행"
          sub={useDevice ? '도착 자동 기록' : '도착 자동 기록 · 기기 위치 꺼짐'}
          onPress={pickDevice}
        />
      );
    }
    if (k === 'manual') {
      return (
        <ListRow
          key={k}
          first={first}
          icon="check"
          label="수동으로 진행"
          sub="도착 직접 기록"
          onPress={() => L.start(tripId, date, 'manual')}
        />
      );
    }
    return (
      <React.Fragment key={k}>
        <ListRow first={first} icon="play" label="시뮬레이터로 재생" sub="실제 위치 아님" onPress={startSim} />
        <SimControls presetsOnly preset={live.sim.preset} onPreset={(p) => L.setPreset(p)} />
      </React.Fragment>
    );
  };
  const showRecordRow = running ? timing !== null : ended;

  return (
    <Screen>
      <Header size="sm" back={back} eyebrow={`여행 진행 · ${trip.title}`} title={date ? dayTitle(date) : '여행 진행'} />
      {status ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`진행 상태 설명 보기, ${status.mode}, ${status.state.text}`}
          onPress={() => setStatusOpen(true)}
          style={styles.statusRow}
        >
          <Chip text={status.mode} tone={simBanner ? 'line' : 'soft'} icon={status.modeIcon} />
          <View style={styles.grow} />
          <Chip text={status.state.text} tone={status.state.tone} />
          <Icon name="help" size={16} color="muted" />
        </Pressable>
      ) : null}
      <Body scroll>
        {!running && dateItems.length > 1 ? <Seg items={dateItems} value={date} onChange={setPicked} /> : null}
        {!running && ended ? <Notice icon="clock" text="여행이 끝나 일정 편집이 잠겼어요." /> : null}
        {running && live.shadow ? <Notice icon="alert" tone="warn" text="GPS 신호가 약해 도착 판정을 잠시 멈췄어요" /> : null}

        {running ? (
          <LiveNowCard
            arrived={current ? { name: currentName ?? '스팟', since: current.enteredAt } : undefined}
            next={timing && eta ? { name: timing.name, eta } : undefined}
            done={timing === null}
            onCancelArrival={current?.visitId ? () => current.visitId && L.cancelArrival(current.visitId) : undefined}
          />
        ) : null}
        {proposalHidden ? (
          <Card variant="tinted">
            <Row gap={SP.l}>
              <Icon name="clock" size={18} color="accent" />
              <View style={styles.grow}>
                <Txt v="nm">{proposalName ? `${proposalName} 조정안` : '뒤 일정 조정안'}</Txt>
              </View>
              <Btn title="조정안 보기" size="sm" variant="quiet" onPress={() => setHiddenProposal(undefined)} />
            </Row>
          </Card>
        ) : null}

        {!hasItems ? (
          <Empty
            title={`${date ? daySegLabel(date) : '이 날'} 일정이 없어요`}
            action={{ label: '루트 계산', onPress: () => navigation.navigate('Planning', { tripId }) }}
          />
        ) : null}

        {!running && hasItems ? (
          <Col>
            <Txt v="nm">어떻게 진행할까요</Txt>
            {startOrder.map((k, i) => startRow(k, i === 0))}
          </Col>
        ) : null}
        {!running ? bgCard : null}

        {hasItems ? (
          <Col gap={SP.xs}>
            <MapCanvas
              height={MAP_H}
              markers={map.markers}
              polylines={map.polylines}
              dots={dots}
              user={running && live.last ? { coord: live.last.coord, accuracyM: live.last.accuracyM } : undefined}
              onMarkerPress={(id) => {
                if (!id.startsWith('base')) navigation.navigate('SpotDetail', { tripId, spotId: id });
              }}
            />
            <Row gap={SP.m}>
              <View style={styles.grow}>
                {map.osmRoads ? <Txt v="mtTight">선은 실제 길 모양 · 길 데이터 OpenStreetMap 기여자</Txt> : null}
              </View>
              <TextLink title="지도 크게 보기" align="right" onPress={openBigMap} />
            </Row>
          </Col>
        ) : null}

        {delayRemoved.length > 0 ? (
          <Card variant="excluded">
            <Col gap={SP.m}>
              <Txt v="label">조정안으로 뺀 스팟</Txt>
              {delayRemoved.map((s) => (
                <Row key={s.id} gap={SP.l}>
                  <View style={styles.text}>
                    <Txt v="nm" numberOfLines={1}>
                      {s.name}
                    </Txt>
                    <Txt v="mtTight">지연 조정안으로 뺌</Txt>
                  </View>
                  <Btn title="되돌리기" icon="undo" size="sm" variant="quiet" onPress={() => restore(s.id, s.name)} />
                </Row>
              ))}
            </Col>
          </Card>
        ) : null}

        {running && live.freeTime ? (
          <FreeTimeCard
            freeTime={live.freeTime}
            from={live.last?.coord}
            now={now}
            onClose={() => L.dismissFreeTime()}
            onPressPlace={openInKakao}
          />
        ) : null}

        {day && hasItems ? (
          <Card>
            <Col gap={SP.m}>
              <Txt v="label">{today ? '오늘 시간표' : `${daySegLabel(date)} 시간표`}</Txt>
              <DayTimeline
                trip={trip}
                day={day}
                activeSpotId={timing?.spotId}
                visitStatus={statuses}
                onPressItem={(spotId) => navigation.navigate('SpotDetail', { tripId, spotId })}
              />
            </Col>
          </Card>
        ) : null}

        {running && hasItems && live.requested === 'sim' ? (
          <SimControls
            preset={live.sim.preset}
            speed={live.sim.speed}
            playing={live.sim.playing}
            virtualNow={live.sim.virtualNow}
            window={live.simWindow}
            jumps={jumps}
            onPreset={(p) => L.setPreset(p)}
            onSpeed={(s) => L.setSpeed(s)}
            onPlay={() => L.play()}
            onPause={() => L.pause()}
            onJump={(t) => L.jumpTo(t)}
          />
        ) : null}

        {running ? bgCard : null}
        {running && live.log.length > 0 ? <LogCard lines={live.log} /> : null}

        {showRecordRow ? <ListRow first icon="book" label="여행일지 보기" onPress={openRecord} /> : null}
        {running ? (
          <Row gap={SP.m} style={styles.endZone}>
            {/* 방장만 표지·이름·날짜를 고친다(TripEditSheet). 홈 카드에서 옮겨 왔다 */}
            {host ? <Btn title="수정" icon="pen" variant="quiet" size="sm" onPress={() => setEditing(true)} /> : null}
            <Btn title="여행 진행 끝내기" variant="quiet" size="sm" onPress={() => setAskStop(true)} />
          </Row>
        ) : null}
      </Body>

      {running && timing ? (
        <Foot>
          <Txt v="mtTight" numberOfLines={1}>{`다음 · ${timing.name}`}</Txt>
          <Row gap={SP.m}>
            <View style={styles.grow}>
              <Btn
                title="구간 안내"
                icon="nav"
                variant="quiet"
                disabled={!nextLeg}
                onPress={() => nextLeg && navigation.navigate('Navigate', { tripId, date, legIndex: nextLeg.index })}
              />
            </View>
            <View style={styles.grow}>
              <Btn
                title="도착 처리"
                icon="check"
                variant={manualArrive ? 'primary' : 'quiet'}
                onPress={() => L.markArrived(timing.spotId)}
              />
            </View>
          </Row>
        </Foot>
      ) : running && timing === null ? (
        <Foot>
          <Btn title="여행일지 보기" icon="book" onPress={openRecord} />
        </Foot>
      ) : null}

      <ProposalSheet
        proposal={proposal}
        info={proposal ? live.proposalInfo[proposal.id] : undefined}
        onApply={(adjId) => proposal && L.acceptProposal(proposal.id, adjId)}
        onKeep={() => proposal && L.rejectProposal(proposal.id)}
        hidden={proposalHidden}
        onHide={() => proposal && setHiddenProposal(proposal.id)}
      />
      <Sheet visible={!!status && statusOpen} onClose={() => setStatusOpen(false)} title="진행 상태">
        {status ? (
          <Col gap={SP.l}>
            <Row gap={SP.s} wrap>
              <Chip text={status.mode} tone={simBanner ? 'line' : 'soft'} icon={status.modeIcon} />
              <Chip text={status.state.text} tone={status.state.tone} />
            </Row>
            {status.lines.map((t) => (
              <Txt key={t} v="body" c="muted">
                {t}
              </Txt>
            ))}
          </Col>
        ) : null}
      </Sheet>
      <ConfirmSheet
        visible={askDevice && !running}
        title="기기 위치를 쓸까요?"
        text="도착을 자동으로 기록하려면 기기 위치가 필요해요. 위치는 이 기기에서만 써요."
        confirmLabel="기기 위치 켜고 시작"
        onConfirm={beginDevice}
        onCancel={() => setAskDevice(false)}
      />
      <TripEditSheet
        tripId={editing ? tripId : undefined}
        onClose={() => setEditing(false)}
        onMore={(id) => {
          setEditing(false);
          navigation.navigate('TripSettings', { tripId: id });
        }}
      />
      <ConfirmSheet
        visible={askStop && running}
        title="여행 진행을 끝낼까요?"
        text="도착 기록과 동선은 기록 지도에 남고, 위치 확인과 조정안이 멈춰요."
        confirmLabel="진행 끝내기"
        onConfirm={() => {
          setAskStop(false);
          L.stop();
        }}
        onCancel={() => setAskStop(false)}
      />
    </Screen>
  );
}

function LogCard({ lines }: { lines: LiveLogLine[] }) {
  return (
    <Card>
      <Col gap={SP.m}>
        <Txt v="label">진행 기록</Txt>
        {lines.slice(0, 12).map((l, i) => (
          <Row key={`${l.t}-${i}`} gap={SP.l} top>
            <View style={styles.timeCol}>
              <Txt v="time">{kstHHMM(l.t)}</Txt>
            </View>
            <Icon name={l.icon} size={14} color="muted" />
            <Txt v="mt" style={styles.grow}>
              {l.text}
            </Txt>
          </Row>
        ))}
      </Col>
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  timeCol: { width: H.timeCol },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.s,
    minHeight: H.touch,
    paddingHorizontal: SP.gutter,
    paddingBottom: SP.s,
  },
  endZone: { paddingTop: SP.xxl },
});
