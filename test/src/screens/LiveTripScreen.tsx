import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { TrackPoint } from '../types';
import type { MapDotInput } from '../core/map/layout';
import { liveDayFromTrip } from '../core/live/context';
import { etaView, jumpTargets, pickLiveDate, type LiveLogLine } from '../core/live/session';
import { isEnded } from '../core/tripStatus';
import { dayLabel, dayShort, kstDate, kstHHMM } from '../core/util';
import { MapCanvas } from '../components/map/MapCanvas';
import { DayTimeline } from '../features/schedule/components/DayTimeline';
import { BG_BLOCK_TEXT, BG_NOTICE_HIDDEN_TEXT } from '../features/live/bgRecordText';
import { BgRecordCard } from '../features/live/components/BgRecordCard';
import { FreeTimeCard } from '../features/live/components/FreeTimeCard';
import { ProposalSheet } from '../features/live/components/ProposalSheet';
import { SimBanner } from '../features/live/components/SimBanner';
import { SimControls } from '../features/live/components/SimControls';
import '../features/live/photoBridge';
import { useDayMap } from '../features/live/useDayMap';
import type { RootScreenProps } from '../navigation/routes';
import { appClock, useNow } from '../services/clock';
import { backgroundRecordBlock, useLive, useSimBanner, useVisitStatuses } from '../store/live';
import { useSession } from '../store/session';
import { usePlan, useTripDoc, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import { Body, Btn, Card, Chip, Col, Empty, H, Header, Icon, Notice, Row, Screen, ScopeBadge, Seg, SP, Txt } from '../ui';

/**
 * 19 여행 진행 · 시뮬레이터(FR-601~604, WP5 소유).
 * 현재 위치(로즈 점, 정확도 50m 초과면 흐린 원), 도착 감지와 수동 취소, 지연 조정안 시트, 빈 시간 추천, 오늘 타임라인.
 * 실제로 경주를 돌아다닐 수 없어 여행 시뮬레이터(시각 가속 재생)로 시연한다. 시뮬레이터면 line 톤 띠를 단다.
 * 판정은 core/live, 상태와 효과 적용은 store/live가 한다. 여기서는 보여주기만 한다.
 * 백그라운드 동선 기록(기본 꺼짐)은 기기 위치를 쓸 때만 보인다. 시작 전에는 진행 방식 아래, 진행 중에는 진행 기록 위에 둔다.
 * 받기가 돌고 있으면 기기 위치 설정과 상관없이 보여 언제든 끌 수 있게 한다.
 * 앱이 화면 밖에 있으면 시계 갱신을 1분으로 늦춘다(백그라운드 기록 중에도 매초 다시 그리지 않게).
 */

const NO_POINTS: TrackPoint[] = [];
const DOT_MAX = 240;

export default function LiveTripScreen({ navigation, route }: RootScreenProps<'LiveTrip'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const live = useLive();
  const now = useNow(live.background ? 60_000 : 1000);
  const useDevice = useSession((s) => s.useDeviceLocation);
  const [picked, setPicked] = useState<string | undefined>(route.params.date);
  /** 접어 둔 조정안 id(바탕을 눌러 닫은 경우). 거절과 다르다 */
  const [hiddenProposal, setHiddenProposal] = useState<string | undefined>(undefined);
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

  const back = navigation.canGoBack() ? navigation.goBack : undefined;
  if (!trip) {
    return (
      <Screen>
        <Header back={back} title="여행 진행" />
        <Body>
          <Empty title="여행방을 찾을 수 없습니다" text="홈에서 여행방을 다시 골라 주세요" />
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
  const dateItems = (plan?.days ?? []).filter((d) => d.items.length > 0).map((d) => ({ key: d.date, label: dayShort(d.date) }));

  const startSim = () => {
    L.start(tripId, date, 'sim');
    L.play();
  };
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
  const today = !!date && kstDate(now) === date;
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

  return (
    <Screen>
      <Header back={back} eyebrow="여행 진행" title={date ? dayLabel(date) : '여행 진행'} sub={trip.title} right={<ScopeBadge phase="2차" />} />
      <Body scroll>
        {simBanner ? <SimBanner /> : null}
        {!running && dateItems.length > 1 ? <Seg items={dateItems} value={date} onChange={setPicked} /> : null}

        {ended ? (
          <Notice
            icon="clock"
            text="여행이 끝나 일정 편집이 잠겼습니다. 사진 추가, 일기, 기록 지도는 계속 쓸 수 있습니다."
          />
        ) : null}

        {!hasItems ? (
          <Empty
            title={`${date ? dayShort(date) : '이 날'} 일정이 없습니다`}
            text="후보를 담고 루트를 계산하면 여행 진행을 시작할 수 있습니다."
            action={{ label: '루트 계산', onPress: () => navigation.navigate('Planning', { tripId }) }}
          />
        ) : (
          <MapCanvas
            height={240}
            markers={map.markers}
            polylines={map.polylines}
            dots={dots}
            user={running && live.last ? { coord: live.last.coord, accuracyM: live.last.accuracyM } : undefined}
            onMarkerPress={(id) => {
              if (!id.startsWith('base')) navigation.navigate('SpotDetail', { tripId, spotId: id });
            }}
          />
        )}
        {hasItems && map.osmRoads ? <Txt v="mtTight">선은 실제 길 모양 · 길 데이터 OpenStreetMap 기여자</Txt> : null}

        {running && live.mode === 'manual' ? (
          <Notice
            icon="locate"
            title="수동 진행 모드"
            text={
              live.requested === 'manual'
                ? '위치를 쓰지 않고 도착을 버튼으로 기록합니다. 계획 열람과 시간표는 그대로 됩니다.'
                : '위치 권한이 없어 도착을 버튼으로 기록합니다. 계획 열람과 시간표는 그대로 됩니다.'
            }
          />
        ) : null}
        {running && live.shadow ? (
          <Notice
            icon="alert"
            tone="warn"
            text="GPS 신호가 약합니다. 정확도가 50m를 넘는 위치는 도착 판정에서 빼고 신호가 돌아오면 이어서 봅니다."
          />
        ) : null}
        {running && live.accuracyUnknown && live.mode === 'device' ? (
          <Notice
            icon="locate"
            text="이 브라우저가 위치 정확도를 알려 주지 않아 도착을 자동으로 판정하지 않습니다. 도착하면 도착 처리 버튼을 눌러 주세요."
          />
        ) : null}
        {proposalHidden ? (
          <Card variant="tinted">
            <Row gap={SP.l}>
              <Icon name="clock" size={18} color="accent" />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt v="nm">{proposalName ? `${proposalName} 조정안` : '뒤 일정 조정안'}</Txt>
                <Txt v="mtTight">
                  {live.requested === 'sim' ? '적용하거나 원래대로를 고를 때까지 재생을 멈춰 둡니다' : '적용하거나 원래대로를 골라 주세요'}
                </Txt>
              </View>
              <Btn title="조정안 보기" size="sm" variant="quiet" onPress={() => setHiddenProposal(undefined)} />
            </Row>
          </Card>
        ) : null}
        {running && live.background && !live.bgActive ? (
          <Notice icon="pause" text="앱이 화면 밖에 있어 위치 확인과 재생을 멈췄습니다. 그 사이 경로는 채우지 않습니다." />
        ) : null}

        {!running && hasItems ? (
          <Card>
            <Col gap={SP.l}>
              <Txt v="nm">어떻게 진행할까요</Txt>
              <Btn title="여행 시뮬레이터로 재생" icon="play" onPress={startSim} />
              <Row gap={SP.m}>
                <View style={{ flex: 1 }}>
                  <Btn
                    title="기기 위치로 시작"
                    icon="locate"
                    size="sm"
                    variant={useDevice ? 'quiet' : 'off'}
                    disabled={!useDevice}
                    onPress={() => L.start(tripId, date, 'device')}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Btn title="수동 진행" icon="check" size="sm" variant="quiet" onPress={() => L.start(tripId, date, 'manual')} />
                </View>
              </Row>
              <Txt v="mtTight">
                {!useDevice
                  ? '기기 위치는 더보기 설정에서 켤 수 있습니다. 시연은 여행 시뮬레이터로 합니다.'
                  : live.bgRecord && !bgBlock && today
                    ? '30초 간격으로 위치를 확인하고, 백그라운드 동선 기록이 켜져 있어 앱이 화면 밖에 있어도 동선과 도착을 남깁니다.'
                    : '앱을 켜 둔 동안만 30초 간격으로 위치를 확인합니다. 웹은 HTTPS 주소에서만 위치를 쓸 수 있습니다.'}
              </Txt>
            </Col>
          </Card>
        ) : null}
        {!running ? bgCard : null}

        {current ? (
          <Card variant="tinted">
            <Row gap={SP.l}>
              <Icon name="check" size={18} color="accent" />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt v="nm">{`${currentName ?? '스팟'} 도착`}</Txt>
                <Txt v="mtTight">{current.enteredAt ? `${kstHHMM(current.enteredAt)}부터 머무는 중` : '머무는 중'}</Txt>
              </View>
              <Btn title="도착 취소" size="sm" variant="quiet" onPress={() => current.visitId && L.cancelArrival(current.visitId)} />
            </Row>
          </Card>
        ) : null}

        {running && timing && eta ? (
          <Card>
            <Col gap={SP.l}>
              <Row>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="label">다음 스팟</Txt>
                  <Txt v="nmLg">{timing.name}</Txt>
                </View>
                <Chip text={eta.delta} tone={eta.tone === 'ok' ? 'ok' : 'line'} />
              </Row>
              <Row gap={SP.xxl}>
                <View style={{ gap: 2 }}>
                  <Txt v="label">계획</Txt>
                  <Txt v="nm">{eta.planned}</Txt>
                </View>
                <View style={{ gap: 2 }}>
                  <Txt v="label">예상 도착</Txt>
                  <Txt v="nm">{eta.eta}</Txt>
                </View>
              </Row>
              <Row gap={SP.m}>
                <View style={{ flex: 1 }}>
                  <Btn
                    title="도착 처리"
                    icon="check"
                    size="sm"
                    variant={live.mode === 'manual' || live.accuracyUnknown ? 'primary' : 'quiet'}
                    onPress={() => L.markArrived(timing.spotId)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Btn
                    title="길찾기"
                    icon="nav"
                    size="sm"
                    variant="quiet"
                    disabled={!nextLeg}
                    onPress={() => nextLeg && navigation.navigate('Navigate', { tripId, date, legIndex: nextLeg.index })}
                  />
                </View>
              </Row>
            </Col>
          </Card>
        ) : null}
        {running && timing === null ? <Notice icon="check" text="오늘 일정을 모두 마쳤습니다. 기록 지도와 일기에서 하루를 돌아볼 수 있습니다." /> : null}

        {running && live.freeTime ? (
          <FreeTimeCard
            freeTime={live.freeTime}
            from={live.last?.coord}
            now={now}
            onClose={() => L.dismissFreeTime()}
          />
        ) : null}

        {delayRemoved.length > 0 ? (
          <Card variant="excluded">
            <Col gap={SP.m}>
              <Txt v="label">조정안으로 뺀 스팟</Txt>
              {delayRemoved.map((s) => (
                <Row key={s.id} gap={SP.l}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt v="nm" numberOfLines={1}>
                      {s.name}
                    </Txt>
                    <Txt v="mtTight">지연 조정안으로 뺌 · 되돌리면 고정으로 돌아옵니다</Txt>
                  </View>
                  <Btn title="되돌리기" icon="undo" size="sm" variant="quiet" onPress={() => restore(s.id, s.name)} />
                </Row>
              ))}
            </Col>
          </Card>
        ) : null}

        {day && hasItems ? (
          <Card>
            <Col gap={SP.m}>
              <Txt v="label">오늘 시간표</Txt>
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

        {hasItems && (!running || live.requested === 'sim') ? (
          <SimControls
            preset={live.sim.preset}
            speed={live.sim.speed}
            playing={running && live.sim.playing}
            virtualNow={running ? live.sim.virtualNow : undefined}
            window={running ? live.simWindow : undefined}
            jumps={jumps}
            onPreset={(p) => L.setPreset(p)}
            onSpeed={(s) => L.setSpeed(s)}
            onPlay={() => (running ? L.play() : startSim())}
            onPause={() => L.pause()}
            onJump={(t) => L.jumpTo(t)}
          />
        ) : null}

        {running ? bgCard : null}
        {running && live.log.length > 0 ? <LogCard lines={live.log} /> : null}

        {running ? <Btn title="여행 진행 끝내기" variant="quiet" size="sm" onPress={() => L.stop()} /> : null}
        {ended || running ? (
          <Row gap={SP.m}>
            <View style={{ flex: 1 }}>
              <Btn title="기록 지도" icon="map" size="sm" variant="quiet" onPress={() => navigation.navigate('RecordMap', { tripId, date })} />
            </View>
            <View style={{ flex: 1 }}>
              <Btn title="사진" icon="camera" size="sm" variant="quiet" onPress={() => navigation.navigate('Photos', { tripId })} />
            </View>
          </Row>
        ) : null}
        <Txt v="mtTight">
          위치는 앱을 켜 둔 동안 30초 간격으로 확인하고, 멈춰 있으면 기록을 쉬고 20m 넘게 움직일 때까지 위치 갱신도 줄입니다. 앱이
          화면 밖에 있으면 멈추고 그 사이 경로는 채우지 않습니다. 백그라운드 동선 기록을 켜면 오늘 일정을 진행하는 동안 화면 밖에서도
          동선과 도착을 남깁니다. 화면 밖 도착은 알림 없이 진행 기록에 남고, 지연 조정안은 앱으로 돌아와서 봅니다. 위치 기록은 이
          기기에만 있고 종료 후 90일 뒤 지웁니다. 그룹원 위치 공유는 꺼져 있습니다(미결정).
        </Txt>
      </Body>

      <ProposalSheet
        proposal={proposal}
        info={proposal ? live.proposalInfo[proposal.id] : undefined}
        onApply={(adjId) => proposal && L.acceptProposal(proposal.id, adjId)}
        onKeep={() => proposal && L.rejectProposal(proposal.id)}
        hidden={proposalHidden}
        onHide={() => proposal && setHiddenProposal(proposal.id)}
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
            <View style={{ width: H.timeCol }}>
              <Txt v="time">{kstHHMM(l.t)}</Txt>
            </View>
            <Icon name={l.icon} size={14} color="muted" />
            <Txt v="mt" style={{ flex: 1 }}>
              {l.text}
            </Txt>
          </Row>
        ))}
      </Col>
    </Card>
  );
}
