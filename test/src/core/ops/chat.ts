import type { Op, Trip } from '../../types';
import { activeMembers } from '../group';

/**
 * chat/* 리듀서(WP3 소유). 기반 작업의 최소 구현을 유지한다.
 * status는 op.seq 유무로 정한다(seq가 있으면 'sent', 없으면 'pending'). 같은 메시지 id는 한 번만 넣는다.
 * 채팅은 개인 모드(혼자 여행)에서도 된다(2026-10-17 사용자 요청): 혼자 쓰는 '채팅 메모'다. 가고 싶은 곳을 적으면 그룹과 같이
 * 대화 인식이 후보로 올린다. 지도·투표·나누기는 그룹 모드에서만 보인다.
 */

export const MESSAGE_MAX = 500;

export function reduce(doc: Trip, op: Op): Trip {
  switch (op.type) {
    case 'chat/send': {
      if (doc.messages.some((m) => m.id === op.message.id)) return doc;
      return {
        ...doc,
        messages: [
          ...doc.messages,
          {
            id: op.message.id,
            memberId: op.actorId,
            text: op.message.text,
            sentAt: op.at,
            seq: op.seq,
            status: op.seq != null ? 'sent' : 'pending',
          },
        ],
      };
    }
    default:
      return doc;
  }
}

export function validate(doc: Trip, op: Op): string | null {
  switch (op.type) {
    case 'chat/send': {
      if (!activeMembers(doc).some((m) => m.id === op.actorId)) return '이 여행방의 멤버가 아닙니다';
      const text = op.message.text.trim();
      if (text === '') return '빈 메시지는 보낼 수 없습니다';
      if (text.length > MESSAGE_MAX) return `메시지는 ${MESSAGE_MAX}자까지 보낼 수 있습니다`;
      return null;
    }
    default:
      return null;
  }
}
