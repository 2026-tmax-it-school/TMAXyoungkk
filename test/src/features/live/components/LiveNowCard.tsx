import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { EtaView } from '../../../core/live/session';
import { kstHHMM } from '../../../core/util';
import { Btn, Card, Chip, Col, Icon, Row, SP, Txt } from '../../../ui';

/**
 * 19 여행 진행 · 지금 카드(WP5 소유). 진행 중 본문 맨 위에 하나만 둔다(UX 점검 B8).
 * - 도착해 있으면 '{스팟} 도착'과 '14:05부터 머무는 중', [도착 취소]. 다음 스팟이 있으면 아래에 한 줄로 덧붙인다.
 * - 아니면 '다음 · {스팟}', 계획·예상 도착 시각, 지연 칩.
 * - 오늘 일정이 끝났으면(timing null) '오늘 일정을 모두 마쳤어요'. 기록 보기는 화면 Foot이 한다.
 * 주 행동([구간 안내], [도착 처리])은 이 카드가 아니라 화면 Foot에 있다. 지연은 경고가 아니라 칩 한 줄이다.
 */
export function LiveNowCard({
  arrived,
  next,
  done,
  onCancelArrival,
}: {
  arrived?: { name: string; since?: number };
  next?: { name: string; eta: EtaView };
  done?: boolean;
  onCancelArrival?: () => void;
}) {
  if (!arrived && !next && !done) return null;
  return (
    <Card variant={arrived || done ? 'tinted' : 'default'}>
      <Col gap={SP.l}>
        {arrived ? (
          <Row gap={SP.l}>
            <Icon name="check" size={18} color="accent" />
            <Col gap={2} grow>
              <Txt v="nm" numberOfLines={1}>{`${arrived.name} 도착`}</Txt>
              <Txt v="mtTight">{arrived.since ? `${kstHHMM(arrived.since)}부터 머무는 중` : '머무는 중'}</Txt>
            </Col>
            {onCancelArrival ? <Btn title="도착 취소" size="sm" variant="quiet" onPress={onCancelArrival} /> : null}
          </Row>
        ) : null}

        {next && arrived ? (
          <View style={styles.nextLine}>
            <Txt v="mt" numberOfLines={1}>{`다음 · ${next.name} · 예상 도착 ${next.eta.eta}`}</Txt>
          </View>
        ) : null}

        {next && !arrived ? (
          <>
            <Row top>
              <Col gap={2} grow>
                <Txt v="label">다음</Txt>
                <Txt v="nmLg" numberOfLines={2}>
                  {next.name}
                </Txt>
              </Col>
              <Chip text={next.eta.delta} tone={next.eta.tone === 'ok' ? 'ok' : 'line'} />
            </Row>
            <Row gap={SP.xxl}>
              <Col gap={2}>
                <Txt v="label">계획</Txt>
                <Txt v="nm">{next.eta.planned}</Txt>
              </Col>
              <Col gap={2}>
                <Txt v="label">예상 도착</Txt>
                <Txt v="nm">{next.eta.eta}</Txt>
              </Col>
            </Row>
          </>
        ) : null}

        {done ? (
          <Row gap={SP.l}>
            <Icon name="check" size={18} color="accent" />
            <Col grow>
              <Txt v="nm">오늘 일정을 모두 마쳤어요</Txt>
            </Col>
          </Row>
        ) : null}
      </Col>
    </Card>
  );
}

const styles = StyleSheet.create({
  nextLine: { paddingTop: SP.m },
});
