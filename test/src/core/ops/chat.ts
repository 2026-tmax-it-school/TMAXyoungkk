import type { Op, Trip } from '../../types';
import { activeMembers, tripMode } from '../group';

/**
 * chat/* 리듀서(WP3 소유). 기반 작업의 최소 구현을 유지한다.
 * status는 op.seq 유무로 정한다(seq가 있으면 'sent', 없으면 'pending'). 같은 메시지 id는 한 번만 넣는다.
 * 채팅은 그룹 모드에서만 된다(개인 모드에서는 채팅과 대화 인식이 비활성, 명세 FR-300 상태도).
 */

export const PERSONAL_MODE_REASON = '개인 모드에서는 채팅을 쓸 수 없습니다. 멤버를 초대하면 켜집니다';
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
      if (tripMode(doc) !== 'group') return PERSONAL_MODE_REASON;
      const text = op.message.text.trim();
      if (text === '') return '빈 메시지는 보낼 수 없습니다';
      if (text.length > MESSAGE_MAX) return `메시지는 ${MESSAGE_MAX}자까지 보낼 수 있습니다`;
      return null;
    }
    default:
      return null;
  }
}
