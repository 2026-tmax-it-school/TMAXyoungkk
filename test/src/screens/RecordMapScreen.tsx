import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import type { TrackPoint } from '../types';
import { MapCanvas } from '../components/map/MapCanvas';
import { datesWithRecords } from '../core/journal/diary';
import { legendFlags, recordMapModel, type LegendFlags, type RecordNoticeKind, type RecordRow } from '../core/journal/recordMap';
import { kstDate, kstHHMM } from '../core/util';
import { DateSeg, initialDate } from '../features/journal/components/DateSeg';
import { RecordTabs } from '../features/journal/components/RecordTabs';
import { daySegLabel } from '../features/schedule/view';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { useNow } from '../services/clock';
import { useLive } from '../store/live';
import { usePlan, useTripDoc } from '../store/trips';
import {
  Body,
  Card,
  Chip,
  Col,
  Empty,
  H,
  Header,
  Icon,
  mapC,
  MapPill,
  NotFound,
  Notice,
  Row,
  Screen,
  SP,
  Txt,
} from '../ui';

/**
 * 22 기록 지도 · 실제 경로(FR-704·804, 3차). 여행 기록 공통 탭(사진 · 일기 · 지도) 아래 날짜 탭.
 * 실제 경로 점(파랑, 날짜 선 색과 겹치지 않음) + 계획 루트 선(날짜 색) + 기록 없는 구간 점선(계획 선과 다른 색).
 * 계산은 core/journal/recordMap(순수)이 한다. 범례 색도 모델 값(plannedColor·gapColor)을 그대로 쓰고,
 * 범례 항목은 legendFlags(model)로 골라 지도에 그려진 것만 보인다.
 * 핀 번호와 도착 목록 번호는 같은 계획 순번이다. 지나친 계획 스팟은 흰 핀과 '지나침', 계획 밖 도착은 '계획 밖' 칩이다.
 * 목록 줄을 누르면 스팟 상세로 간다.
 * 위치 로그는 여행 진행(useLive.track)에서 오고, 권한이 거부되면 도착 지점만 순서대로 잇는다.
 * 그날 권한 거부였는지는 날짜별 거부 기록(useLive.denied)으로 안다. 지난 날짜에도 '위치 권한이 없어' 안내가 뜬다
 * (도착 기록이 없으면 '이동 기록이 없어요'). 위치 안내는 지도 아래에 두고, 시뮬레이터 기록은 지도 위 알약으로 띄운다.
 * 위치 이력은 종료 후 90일이 지나면 쓰지 않는다(공유 isTrackExpired).
 * 뒤로는 useBack('Home'), 없는 여행방은 NotFound('홈으로').
 */

const NO_POINTS: TrackPoint[] = [];

const NOTICE_TEXT: Record<Exclude<RecordNoticeKind, 'sim'>, string> = {
  expired: '위치 이력은 여행 종료 후 90일이 지나 지웠어요.',
  denied: '이 날은 위치 권한이 없어 도착 지점만 순서대로 이었어요.',
  deniedNone: '이 날은 위치 권한이 없었고 도착 기록도 없어 이동 기록이 없어요.',
  noLog: '이 날은 위치 기록이 없어 도착 지점만 순서대로 이었어요.',
};

export default function RecordMapScreen({ navigation, route }: RootScreenProps<'RecordMap'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const now = useNow();
  const back = useBack('Home');
  const trackByDate = useLive((s) => s.track[tripId]);
  const deniedByDate = useLive((s) => s.denied[tripId]);
  const firstDate = () => {
    if (!trip) return '';
    const withRecords = [...datesWithRecords(trip), ...Object.keys(trackByDate ?? {})].sort();
    return initialDate(trip, kstDate(now), route.params.date, withRecords);
  };
  const [picked, setDate] = useState(firstDate);
  // 첫 화면에서 여행방이 아직 없었으면 여기서 날짜를 정한다.
  const date = picked || firstDate();
  const points = trackByDate?.[date] ?? NO_POINTS;
  const denied = deniedByDate?.[date];

  const model = useMemo(
    () => (trip ? recordMapModel(trip, plan, date, points, { now, denied }) : undefined),
    [trip, plan, date, points, now, denied],
  );

  if (!trip || !model) {
    return (
      <Screen>
        <Header back={back} title="여행 기록" />
        <Body>
          <NotFound title="여행방을 찾을 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
        </Body>
      </Screen>
    );
  }

  const spotName = (id?: string) => (id ? trip.spots.find((s) => s.id === id)?.name : undefined);
  const sim = model.notices.includes('sim');
  const placeNotices = model.notices.filter((k): k is Exclude<RecordNoticeKind, 'sim'> => k !== 'sim');

  return (
    <Screen>
      <Header back={back} eyebrow={trip.title} title="여행 기록" sub={daySegLabel(date)} />
      <View style={{ paddingHorizontal: SP.gutter, paddingBottom: SP.m, gap: SP.m }}>
        <RecordTabs current="RecordMap" tripId={tripId} date={date} />
        <DateSeg trip={trip} value={date} onChange={setDate} />
      </View>
      <Body scroll>
        {model.empty ? (
          <>
            <Empty icon="map" title={`${daySegLabel(date)} 기록이 없어요`} />
            {sim ? <Chip text="시뮬레이터 기록" icon="play" tone="line" /> : null}
          </>
        ) : (
          <>
            <View>
              <MapCanvas
                markers={model.markers}
                polylines={model.polylines}
                dots={model.dots}
                fitTo={model.fitTo.length > 0 ? model.fitTo : undefined}
                height={340}
                onMarkerPress={(id) => {
                  if (id !== 'base') navigation.navigate('SpotDetail', { tripId, spotId: id });
                }}
              />
              {sim ? (
                <View style={styles.simPill}>
                  <MapPill icon="play" label="시뮬레이터 기록" a11yLabel="여행 시뮬레이터로 만든 기록, 실제 위치 아님" />
                </View>
              ) : null}
            </View>
            <Legend planned={model.plannedColor} gap={model.gapColor} flags={legendFlags(model)} />
          </>
        )}
        {placeNotices.map((k) => (
          <Notice key={k} icon="locate" text={NOTICE_TEXT[k]} />
        ))}

        {model.rows.length > 0 ? (
          <Card>
            <Col gap={SP.xs}>
              <Txt v="eyebrow" c="muted">
                {`방문 기록 · 도착 ${model.arrivals}곳`}
              </Txt>
              {model.rows.map((r) => (
                <VisitRow
                  key={r.spotId}
                  row={r}
                  name={spotName(r.spotId) ?? '방문한 곳'}
                  onPress={() => navigation.navigate('SpotDetail', { tripId, spotId: r.spotId })}
                />
              ))}
            </Col>
          </Card>
        ) : null}
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // 지도 위 왼쪽 위 알약. 지도를 끄는 손가락을 막지 않는다(pointerEvents는 StyleSheet로 준다).
  simPill: { position: 'absolute', top: SP.l, left: SP.l, pointerEvents: 'none' },
});

const NUM_COL = 20;

/** 스크린리더 이름 '{번호} {이름} {시각} 도착'. 지나친 곳은 '{번호} {이름} 지나침', 계획 밖은 번호 대신 '계획 밖' */
function visitA11y(row: RecordRow, name: string): string {
  const head = row.label ?? '계획 밖';
  if (row.state === 'passed' || row.t == null) return `${head} ${name} 지나침`;
  return `${head} ${name} ${kstHHMM(row.t)} 도착`;
}

/** 목업 11 목록 행: 로즈 번호 열(핀 번호와 같은 계획 순번), 이름, 오른쪽 시각과 누를 수 있다는 꺾쇠. 누르면 스팟 상세(높이 44 이상) */
function VisitRow({ row, name, onPress }: { row: RecordRow; name: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={visitA11y(row, name)}
      onPress={onPress}
      style={{ minHeight: H.touch, justifyContent: 'center' }}
    >
      <Row gap={SP.l}>
        <View style={{ width: NUM_COL }}>
          <Txt v="time" c={row.state === 'passed' ? 'muted' : 'accent'}>
            {row.label ?? ''}
          </Txt>
        </View>
        <Col grow>
          <Txt v="nm" c={row.state === 'passed' ? 'muted' : 'ink'} numberOfLines={1}>
            {name}
          </Txt>
        </Col>
        {row.state === 'passed' ? <Chip text="지나침" tone="line" /> : null}
        {row.state === 'offPlan' ? <Chip text="계획 밖" tone="line" /> : null}
        {row.t != null ? <Txt v="mtTight">{kstHHMM(row.t)}</Txt> : null}
        <Icon name="right" size={18} color="muted" stroke={2} />
      </Row>
    </Pressable>
  );
}

const SW = 22;
const SH = 12;

/**
 * 범례. 견본은 MapCanvas와 같은 값으로 그린다(선 3.4, 점선 '6 5', 기점 흰 채움 테두리 3, 이동 점 r 3.5·흰 테두리 1.5, 사진 점 r 2.4).
 * 이동 점은 렌더러와 같은 파랑(ink tone → mapC.user)이고, 계획 선·점선 색은 모델이 고른 값이다.
 * 항목은 flags(legendFlags)에서 켜진 것만, 곧 지금 지도에 그려진 것만 보인다. 하나도 없으면 그리지 않는다.
 */
function Legend({ planned, gap, flags }: { planned: keyof typeof mapC; gap: keyof typeof mapC; flags: LegendFlags }) {
  if (!Object.values(flags).some(Boolean)) return null;
  return (
    <Row gap={SP.xl} wrap>
      {flags.planned ? (
        <LegendItem label="계획 루트">
          <Svg width={SW} height={SH}>
            <Line x1={2} y1={SH / 2} x2={SW - 2} y2={SH / 2} stroke={mapC[planned]} strokeWidth={3.4} strokeLinecap="round" />
          </Svg>
        </LegendItem>
      ) : null}
      {flags.actual ? (
        <LegendItem label="실제 이동 지점">
          <Svg width={SW} height={SH}>
            {[5, 11, 17].map((x) => (
              <Circle key={x} cx={x} cy={SH / 2} r={3.5} fill={mapC.user} stroke={mapC.white} strokeWidth={1.5} />
            ))}
          </Svg>
        </LegendItem>
      ) : null}
      {flags.photo ? (
        <LegendItem label="사진 위치">
          <Svg width={SH} height={SH}>
            <Circle cx={SH / 2} cy={SH / 2} r={2.4} fill={mapC.faint} />
          </Svg>
        </LegendItem>
      ) : null}
      {flags.gap ? (
        <LegendItem label="기록 없는 구간">
          <Svg width={SW} height={SH}>
            <Line x1={1} y1={SH / 2} x2={SW - 1} y2={SH / 2} stroke={mapC[gap]} strokeWidth={3.4} strokeDasharray="6 5" />
          </Svg>
        </LegendItem>
      ) : null}
      {flags.base ? (
        <LegendItem label="기점">
          <Svg width={SH + 4} height={SH + 4}>
            <Circle cx={(SH + 4) / 2} cy={(SH + 4) / 2} r={5.5} fill={mapC.white} stroke={mapC.ink} strokeWidth={3} />
          </Svg>
        </LegendItem>
      ) : null}
      {flags.passed ? (
        <LegendItem label="지나친 스팟">
          <Svg width={SH + 4} height={SH + 4}>
            <Circle cx={(SH + 4) / 2} cy={(SH + 4) / 2} r={6} fill={mapC.excludedPin} stroke={mapC.faint} strokeWidth={2} />
          </Svg>
        </LegendItem>
      ) : null}
    </Row>
  );
}

function LegendItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Row gap={SP.s}>
      {children}
      <Txt v="mtTight">{label}</Txt>
    </Row>
  );
}
