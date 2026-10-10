import React from 'react';
import { Pressable, View } from 'react-native';

import type { BgRecordBlock } from '../../../core/live/background';
import { Card, Chip, Col, Row, Txt } from '../../../ui';
import { BG_RECORD_LABEL, bgRecordSub } from '../bgRecordText';

/**
 * 19 백그라운드 동선 기록 줄(WP5 소유). 기본 꺼짐이고 사용자가 켠다. 줄 전체가 스위치다(18 더보기 ToggleRow와 같은 모양).
 * 켤 때만 '항상 허용'을 묻는다(store/live setBgRecord). 웹·Expo Go 등 켤 수 없는 곳에서는 누를 수 없고 이유를 보여준다.
 * 오늘 날짜를 기기 위치로 진행할 때만 쓰인다. 시뮬레이터·수동 진행에는 영향이 없다.
 * 칩은 옵션 값(켜짐·꺼짐)이고, 실제로 도는지는 아래 설명(bgRecordSub)이 말한다.
 */
export function BgRecordCard({
  on,
  active,
  block,
  running,
  today,
  busy,
  onChange,
}: {
  on: boolean;
  active: boolean;
  block: BgRecordBlock | undefined;
  running: boolean;
  today: boolean;
  busy: boolean;
  onChange: (on: boolean) => void;
}) {
  const sub = bgRecordSub({ on, active, block, running, today });
  const disabled = !!block || busy;
  const chip = block ? '켤 수 없음' : busy ? '확인 중' : on ? '켜짐' : '꺼짐';
  return (
    <Card>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={BG_RECORD_LABEL}
        accessibilityHint={sub}
        accessibilityState={{ checked: on && !block, disabled }}
        disabled={disabled}
        onPress={() => onChange(!on)}
      >
        <Row top>
          <Col gap={2} grow>
            <Txt v="nm">{BG_RECORD_LABEL}</Txt>
            <Txt v="mtTight">{sub}</Txt>
          </Col>
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Chip text={chip} tone={on && !block ? 'soft' : 'line'} icon={on && !block && !busy ? 'check' : undefined} />
          </View>
        </Row>
      </Pressable>
    </Card>
  );
}
