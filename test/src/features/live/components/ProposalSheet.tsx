import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { Adjustment, LiveProposal } from '../../../types';
import { PROPOSAL_APPLY, PROPOSAL_KEEP, PROPOSAL_TITLE, proposalLead } from '../../../core/live/delay';
import { toHHMM } from '../../../core/util';
import type { ProposalInfo } from '../../../store/live';
import { Btn, Card, Col, Icon, Row, Sheet, SP, Txt } from '../../../ui';

/**
 * 지연 조정안 시트(FR-603, WP5 소유). 경고가 아니라 제안이다.
 * 틴트 카드에 시계 아이콘, 제목 '뒤 일정을 이렇게 바꿀까요', 버튼 '적용'과 '원래대로'.
 * 조정안이 여럿이면 고를 수 있고, 첫 줄(순서 변경 우선, WP4 replanForDelay 순서)이 기본이다.
 * 바탕을 누르거나 뒤로 가기를 하면 시트만 접는다(onHide). 거절은 '원래대로' 버튼으로만 한다.
 * 거절은 30분 알림 제한을 걸기 때문에, 실수로 닫은 것과 구분해야 한다.
 */

const KIND_TEXT: Record<Adjustment['kind'], string> = {
  reorder: '순서 변경',
  shortenStay: '체류 줄이기',
  moveToDate: '다른 날로 옮기기',
  exclude: '제외 스팟으로 빼기',
};

export function ProposalSheet({
  proposal,
  info,
  onApply,
  onKeep,
  hidden,
  onHide,
}: {
  proposal?: LiveProposal;
  info?: ProposalInfo;
  onApply: (adjustmentId: string) => void;
  onKeep: () => void;
  /** 접어 둔 상태(19가 '조정안 보기'로 다시 연다) */
  hidden?: boolean;
  onHide: () => void;
}) {
  const [picked, setPicked] = useState<string | undefined>(proposal?.adjustments[0]?.id);
  useEffect(() => setPicked(proposal?.adjustments[0]?.id), [proposal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!proposal) return null;
  const lead = info
    ? proposalLead(info.name, toHHMM(Math.round(info.etaMin)), toHHMM(Math.round(info.plannedArriveMin)), proposal.delayMin)
    : `다음 스팟 예상 도착이 계획보다 ${proposal.delayMin}분 뒤`;
  const chosen = proposal.adjustments.find((a) => a.id === picked) ?? proposal.adjustments[0];

  return (
    <Sheet visible={!hidden} onClose={onHide}>
      <Card variant="tinted">
        <Col gap={SP.s}>
          <Row gap={SP.m}>
            <Icon name="clock" size={18} color="accent" />
            <Txt v="nm">{PROPOSAL_TITLE}</Txt>
          </Row>
          <Txt v="mt">{lead}</Txt>
        </Col>
      </Card>
      <Col gap={SP.m}>
        {proposal.adjustments.map((a) => (
          <Card key={a.id} variant={a.id === chosen?.id ? 'selected' : 'default'} onPress={() => setPicked(a.id)}>
            <Row gap={SP.l}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt v="label" c={a.id === chosen?.id ? 'accent' : 'muted'}>
                  {KIND_TEXT[a.kind]}
                </Txt>
                <Txt v="nm">{a.label}</Txt>
              </View>
              {a.savedMin > 0 ? <Txt v="mt">{`${a.savedMin}분 줄어듦`}</Txt> : null}
            </Row>
          </Card>
        ))}
      </Col>
      <Row gap={SP.m}>
        <View style={{ flex: 1 }}>
          <Btn title={PROPOSAL_KEEP} variant="quiet" onPress={onKeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn title={PROPOSAL_APPLY} onPress={() => chosen && onApply(chosen.id)} disabled={!chosen} />
        </View>
      </Row>
    </Sheet>
  );
}
