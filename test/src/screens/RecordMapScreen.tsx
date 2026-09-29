import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import type { TrackPoint } from '../types';
import { MapCanvas } from '../components/map/MapCanvas';
import { datesWithRecords } from '../core/journal/diary';
import { recordMapModel, type RecordNoticeKind, type RecordRow } from '../core/journal/recordMap';
import { dayLabel, kstDate, kstHHMM } from '../core/util';
import { DateSeg, initialDate } from '../features/journal/components/DateSeg';
import type { RootScreenProps } from '../navigation/routes';
import { useNow } from '../services/clock';
import { useLive } from '../store/live';
import { usePlan, useTripDoc } from '../store/trips';
import {
  Body,
  Btn,
  Card,
  Chip,
  Col,
  Empty,
  Header,
  mapC,
  Notice,
  Row,
  Screen,
  ScopeBadge,
  SP,
  Txt,
} from '../ui';

/**
 * 22 기록 지도 · 실제 경로(FR-704·804, 3차).
 * 실제 경로 점(잉크) + 계획 루트 선(날짜 색) + 기록 없는 구간 점선. 계산은 core/journal/recordMap(순수)이 한다.
 * 핀 번호와 도착 목록 번호는 같은 계획 순번이다. 지나친 계획 스팟은 흰 핀과 '지나침', 계획 밖 도착은 '계획 밖' 칩이다.
 * 위치 로그는 여행 진행(useLive.track)에서 오고, 권한이 거부되면 도착 지점만 순서대로 잇는다.
 * 위치 이력은 종료 후 90일이 지나면 쓰지 않는다(공유 isTrackExpired).
 */

const NO_POINTS: TrackPoint[] = [];

const NOTICE_TEXT: Record<RecordNoticeKind, string> = {
  expired: '위치 이력은 여행 종료 후 90일이 지나 지웠습니다. 도착 지점만 순서대로 이어 보여줍니다.',
  denied: '위치 권한이 없어 도착 지점만 순서대로 이었습니다. 그 사이 이동은 점선으로 남깁니다.',
  noLog: '이 날은 위치 기록이 없어 도착 지점만 순서대로 이었습니다.',
  sim: '여행 시뮬레이터로 만든 기록 · 실제 위치 아님',
};

export default function RecordMapScreen({ navigation, route }: RootScreenProps<'RecordMap'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const now = useNow();
  const permission = useLive((s) => s.permission);
  const trackByDate = useLive((s) => s.track[tripId]);
  const firstDate = () => {
    if (!trip) return '';
    const withRecords = [...datesWithRecords(trip), ...Object.keys(trackByDate ?? {})].sort();
    return initialDate(trip, kstDate(now), route.params.date, withRecords);
  };
  const [picked, setDate] = useState(firstDate);
  // 첫 화면에서 여행방이 아직 없었으면 여기서 날짜를 정한다.
  const date = picked || firstDate();
  const points = trackByDate?.[date] ?? NO_POINTS;

  const model = useMemo(
    () => (trip ? recordMapModel(trip, plan, date, points, { now, permission }) : undefined),
    [trip, plan, date, points, now, permission],
  );

  const back = navigation.canGoBack() ? navigation.goBack : undefined;
  if (!trip || !model) {
    return (
      <Screen>
        <Header back={back} title="기록 지도" />
        <Body>
          <Empty title="여행방을 찾을 수 없습니다" text="홈에서 여행방을 다시 골라 주세요" />
        </Body>
      </Screen>
    );
  }

  const spotName = (id?: string) => (id ? trip.spots.find((s) => s.id === id)?.name : undefined);

  return (
    <Screen>
      <Header back={back} eyebrow={trip.title} title="기록 지도" sub={dayLabel(date)} right={<ScopeBadge phase="3차" />} />
      <Body scroll>
        <DateSeg trip={trip} value={date} onChange={setDate} />
        {model.notices.map((k) => (
          <Notice key={k} icon={k === 'sim' ? 'play' : 'locate'} text={NOTICE_TEXT[k]} />
        ))}

        {model.empty ? (
          <Empty
            title={`${dayLabel(date)} 기록이 없습니다`}
            text="루트를 계산하거나 여행 진행에서 도착을 기록하면 이 날의 경로가 그려집니다"
          />
        ) : (
          <>
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
            <Legend planned={model.plannedColor} />
            <Row gap={SP.s} wrap>
              <Chip text={`도착 ${model.arrivals}곳`} tone="line" />
            </Row>
          </>
        )}

        {model.rows.length > 0 ? (
          <Card>
            <Col gap={SP.m}>
              <Txt v="eyebrow" c="muted">
                방문 기록
              </Txt>
              {model.rows.map((r) => (
                <VisitRow key={r.spotId} row={r} name={spotName(r.spotId) ?? '방문한 곳'} />
              ))}
            </Col>
          </Card>
        ) : null}

        <Row>
          <View style={{ flex: 1 }}>
            <Btn title="사진" icon="camera" variant="quiet" size="sm" onPress={() => navigation.navigate('Photos', { tripId })} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title="일기" icon="book" variant="quiet" size="sm" onPress={() => navigation.navigate('Diary', { tripId, date })} />
          </View>
        </Row>
        <Txt v="mtTight">
          앱을 켜 둔 동안만 30초 간격으로 기록합니다. 앱이 꺼져 있던 구간은 채워 넣지 않고 점선으로 둡니다. 그룹원 위치 공유는 꺼져
          있습니다(미결정).
        </Txt>
      </Body>
    </Screen>
  );
}

const NUM_COL = 20;

/** 목업 11 목록 행: 로즈 번호 열(핀 번호와 같은 계획 순번), 이름, 오른쪽 시각 */
function VisitRow({ row, name }: { row: RecordRow; name: string }) {
  return (
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
    </Row>
  );
}

const SW = 22;
const SH = 12;

/** 범례. 견본은 MapCanvas와 같은 값으로 그린다(선 3.4, 점선 '6 5', 기점 흰 채움 테두리 3, 이동 점 r 3.5·흰 테두리 1.5, 사진 점 r 2.4) */
function Legend({ planned }: { planned: keyof typeof mapC }) {
  return (
    <Row gap={SP.xl} wrap>
      <LegendItem label="계획 루트">
        <Svg width={SW} height={SH}>
          <Line x1={2} y1={SH / 2} x2={SW - 2} y2={SH / 2} stroke={mapC[planned]} strokeWidth={3.4} strokeLinecap="round" />
        </Svg>
      </LegendItem>
      <LegendItem label="실제 이동 지점">
        <Svg width={SW} height={SH}>
          {[5, 11, 17].map((x) => (
            <Circle key={x} cx={x} cy={SH / 2} r={3.5} fill={mapC.user} stroke={mapC.white} strokeWidth={1.5} />
          ))}
        </Svg>
      </LegendItem>
      <LegendItem label="사진 위치">
        <Svg width={SH} height={SH}>
          <Circle cx={SH / 2} cy={SH / 2} r={2.4} fill={mapC.faint} />
        </Svg>
      </LegendItem>
      <LegendItem label="기록 없는 구간">
        <Svg width={SW} height={SH}>
          <Line x1={1} y1={SH / 2} x2={SW - 1} y2={SH / 2} stroke={mapC.ink} strokeWidth={3.4} strokeDasharray="6 5" />
        </Svg>
      </LegendItem>
      <LegendItem label="기점">
        <Svg width={SH + 4} height={SH + 4}>
          <Circle cx={(SH + 4) / 2} cy={(SH + 4) / 2} r={5.5} fill={mapC.white} stroke={mapC.ink} strokeWidth={3} />
        </Svg>
      </LegendItem>
      <LegendItem label="지나친 스팟">
        <Svg width={SH + 4} height={SH + 4}>
          <Circle cx={(SH + 4) / 2} cy={(SH + 4) / 2} r={6} fill={mapC.excludedPin} stroke={mapC.faint} strokeWidth={2} />
        </Svg>
      </LegendItem>
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
