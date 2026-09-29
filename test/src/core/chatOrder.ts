import type { ChatMessage, Trip } from '../types';

/**
 * FR-304 순서 보정. 서버 순번(seq)이 있는 메시지를 seq 순으로 두고,
 * 아직 전송 대기(pending)인 메시지는 보낸 시각 순으로 그 뒤에 붙인다.
 */
export function orderedMessages(trip: Trip): ChatMessage[] {
  const sent = trip.messages.filter((m) => m.seq != null);
  const pending = trip.messages.filter((m) => m.seq == null);
  sent.sort((a, b) => (a.seq as number) - (b.seq as number));
  pending.sort((a, b) => a.sentAt - b.sentAt || (a.id < b.id ? -1 : 1));
  return [...sent, ...pending];
}
