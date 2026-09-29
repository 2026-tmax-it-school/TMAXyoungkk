import React from 'react';
import { Pressable, View } from 'react-native';

import type { DayPlan, ItemNotice, Trip, Visit } from '../../../types';
import { Card, Chip, Col, H, Icon, lineC, R, Row, SP, surfaceC, Txt } from '../../../ui';
import { timelineRows, transportIcon, type TimelineRow } from '../timeline';
import { legLabel, VISIT_LABEL } from '../view';

/**
 * 하루 타임라인(WP4 소유). 09 시간표, 19 여행 진행이 같이 쓴다. 행 계산은 timeline.ts(순수).
 * 목업 09: 왼쪽 52px 고정 폭 시각 열, 가운데 18px 축(스팟은 채운 점, 기점은 속 빈 점), 이동 구간은 카드가 아닌 얇은 줄.
 * 목업 grid 52/18/1fr, column-gap 8. 축 선은 행 전체 높이의 1px, 점은 행 위에서 17px(시각 글자와 같은 높이)에 고정한다.
 * activeSpotId는 선택 테두리, visitStatus는 도착·지나침 칩으로 보여준다. onPressLeg를 주면 이동 줄을 눌러 12로 간다.
 */

const AXIS_W = 18;
const DOT = 9;
/** 목업 .tl-item .dot margin-top */
const DOT_TOP = 17;
/** 목업 column-gap */
const COL_GAP = SP.m;
/** 시각 글자 위 여백(점 가운데와 맞춘다) */
const TIME_TOP = 14;

const NOTICE_TONE: Record<ItemNotice['kind'], 'warn' | 'line'> = {
  outsideHours: 'warn',
  overrideLate: 'warn',
  noRoute: 'warn',
  fallbackTransport: 'warn',
  estimated: 'line',
};

/** 축. 세로선은 행 높이 전체에 깔고(첫 행 위쪽·마지막 행 아래쪽만 숨긴다), 점은 행 위에서 DOT_TOP에 둔다 */
function Axis({ dot, top, bottom }: { dot?: 'fill' | 'hollow'; top?: boolean; bottom?: boolean }) {
  const mid = DOT_TOP + DOT / 2;
  return (
    <View style={{ width: AXIS_W, alignSelf: 'stretch', marginRight: COL_GAP }}>
      {top ? (
        <View style={{ position: 'absolute', left: (AXIS_W - 1) / 2, width: 1, top: 0, height: dot ? mid : '100%', backgroundColor: lineC.line }} />
      ) : null}
      {bottom ? (
        <View style={{ position: 'absolute', left: (AXIS_W - 1) / 2, width: 1, top: dot ? mid : 0, bottom: 0, backgroundColor: lineC.line }} />
      ) : null}
      {dot ? (
        <View
          style={{
            marginTop: DOT_TOP,
            alignSelf: 'center',
            width: DOT,
            height: DOT,
            borderRadius: DOT / 2,
            backgroundColor: dot === 'fill' ? surfaceC.accent : surfaceC.card,
            borderWidth: dot === 'fill' ? 0 : 2,
            borderColor: lineC.accent,
          }}
        />
      ) : null}
    </View>
  );
}

function statusChip(status?: Visit['status']) {
  if (!status) return null;
  return <Chip text={VISIT_LABEL[status]} tone={status === 'arrived' ? 'ok' : 'line'} />;
}

export function DayTimeline({
  trip,
  day,
  activeSpotId,
  visitStatus,
  onPressItem,
  onPressLeg,
}: {
  trip: Trip;
  day: DayPlan;
  activeSpotId?: string;
  visitStatus?: Record<string, Visit['status']>;
  onPressItem?: (spotId: string) => void;
  /** 이동 줄을 누르면 부른다(legIndex 0은 기점에서 첫 스팟) */
  onPressLeg?: (legIndex: number) => void;
}) {
  void trip;
  const rows = timelineRows(day, visitStatus);
  const renderRow = (r: TimelineRow, i: number) => {
    const first = i === 0;
    const last = i === rows.length - 1;
    if (r.kind === 'leg') {
      const line = (
        <Row gap={SP.s}>
          <Icon name={transportIcon(r.transport)} size={14} color="muted" />
          <Txt v="chipLine" c="muted">
            {legLabel(r.transport, r.minutes, r.estimated)}
          </Txt>
        </Row>
      );
      return (
        <View key={r.key} style={{ flexDirection: 'row' }}>
          <View style={{ width: H.timeCol, marginRight: COL_GAP }} />
          <Axis top bottom />
          <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 3 }}>
            {onPressLeg ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`이동수단 바꾸기 ${legLabel(r.transport, r.minutes, r.estimated)}`}
                onPress={() => onPressLeg(r.legIndex)}
                hitSlop={6}
              >
                {line}
              </Pressable>
            ) : (
              line
            )}
          </View>
        </View>
      );
    }
    const hollow = r.kind !== 'spot';
    const content =
      r.kind === 'spot' ? (
        <Card
          variant={r.spotId === activeSpotId ? 'selected' : r.status === 'skipped' || r.status === 'cancelled' ? 'flat' : 'default'}
          onPress={onPressItem ? () => onPressItem(r.spotId) : undefined}
          style={{ padding: SP.xl, borderRadius: R.card }}
        >
          <Row top>
            <Col grow gap={SP.xs}>
              <Txt v="nm" c={r.status === 'skipped' || r.status === 'cancelled' ? 'muted' : 'ink'}>
                {r.title}
              </Txt>
              <Txt v="mtTight">{`${r.time} – ${r.depart} · ${r.stayMin}분`}</Txt>
            </Col>
            <Col gap={SP.xs}>
              {r.pinned ? <Chip text="고정" icon="pinlock" /> : <Chip text={`제안자 ${r.proposerCount}`} />}
              {statusChip(r.status)}
            </Col>
          </Row>
          {r.notices.length || r.carryOver || r.manual ? (
            <Row gap={SP.s} wrap>
              {r.manual ? <Chip text="직접 편집" tone="line" /> : null}
              {r.carryOver ? <Chip text="다음 날 이월 제안" tone="warn" /> : null}
              {r.notices.map((n) => (
                <Chip key={n.kind + n.text} text={n.text} tone={NOTICE_TONE[n.kind]} />
              ))}
            </Row>
          ) : null}
        </Card>
      ) : (
        <Col gap={SP.xs}>
          <Txt v={r.kind === 'end' ? 'nm' : 'nmSm'}>{r.title}</Txt>
          {r.kind === 'base' || r.kind === 'return' ? <Txt v="mtTight">{r.sub}</Txt> : null}
          {r.kind === 'return' && r.notices.length ? (
            <Row gap={SP.s} wrap>
              {r.notices.map((n) => (
                <Chip key={n.kind + n.text} text={n.text} tone={NOTICE_TONE[n.kind]} />
              ))}
            </Row>
          ) : null}
        </Col>
      );
    return (
      <View key={r.key} style={{ flexDirection: 'row' }}>
        <View style={{ width: H.timeCol, marginRight: COL_GAP, paddingTop: TIME_TOP }}>
          <Txt v="time">{r.time}</Txt>
        </View>
        <Axis dot={hollow ? 'hollow' : 'fill'} top={!first} bottom={!last} />
        <View style={{ flex: 1, paddingVertical: SP.m }}>{content}</View>
      </View>
    );
  };
  return <View>{rows.map(renderRow)}</View>;
}
