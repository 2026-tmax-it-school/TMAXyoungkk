import type { Place } from '../../types';
import { extractForMessage } from '../../core/extract';
import { spotFromPlace } from '../../core/extract/spot';
import { regionById } from '../../data/regions';
import { getServices } from '../../services/registry';
import { useTrips, type DispatchResult } from '../../store/trips';

/**
 * 채팅 보내기와 대화 인식(FR-304·401, WP3 소유). 05 화면과 시나리오 재생이 같은 길을 쓴다.
 * 1. chat/send를 보낸다(오프라인이면 pending으로 남고 재연결 때 순서대로 전송된다).
 * 2. 그 메시지에서 장소를 뽑아 spot/extracted를 보낸다. 뽑은 것이 없으면 아무것도 보내지 않는다
 *    (인식 실패 시 후보도 안내도 없다).
 * 키가 없으면 추출은 로컬 규칙과 장소 사전으로 돌아 오프라인에서도 된다.
 * 카카오 키가 있으면 장소 검색이 네트워크를 쓰므로, 오프라인에서 보낸 메시지는 추출이 결과 없음으로 끝나고
 * 재연결 뒤에도 다시 추출하지 않는다(메시지는 재전송 큐로 도착한다). 재연결 때 다시 추출하는 일은 통합 과제로 남긴다.
 */
export async function sendChatMessage(
  tripId: string,
  text: string,
  opts: { actorId?: string } = {},
): Promise<DispatchResult> {
  const { ids, extraction, places } = getServices();
  const messageId = ids.next('msg');
  const sent = useTrips.getState().dispatch(tripId, { type: 'chat/send', message: { id: messageId, text } }, opts);
  if (!sent.ok) return sent;
  await extractAndRecord(tripId, { id: messageId, text, memberId: sent.op.actorId, at: sent.op.at }, { extraction, places, ids });
  return sent;
}

async function extractAndRecord(
  tripId: string,
  message: { id: string; text: string; memberId: string; at: number },
  deps: Pick<ReturnType<typeof getServices>, 'extraction' | 'places' | 'ids'>,
): Promise<void> {
  const doc = useTrips.getState().docs[tripId];
  const region = doc ? regionById(doc.region) : undefined;
  if (!doc || !region) return;
  const r = await extractForMessage(doc, message, { ...deps, region, at: message.at });
  if (r.created.length === 0 && r.mergedSpotIds.length === 0 && r.ambiguous.length === 0) return;
  useTrips.getState().dispatch(
    tripId,
    {
      type: 'spot/extracted',
      messageId: message.id,
      created: r.created,
      mergedSpotIds: r.mergedSpotIds,
      ambiguous: r.ambiguous,
      highlights: r.highlights,
    },
    { actorId: message.memberId },
  );
}

/** 추출 되돌리기(FR-402). 그 메시지로 새로 생긴 후보만 지우고, 병합된 후보에서는 그 메시지의 제안만 뺀다. */
export function undoExtraction(tripId: string, messageId: string): DispatchResult {
  return useTrips.getState().dispatch(tripId, { type: 'spot/undoExtraction', messageId });
}

/**
 * 동명 장소 고르기(FR-401). 고른 곳이 이미 후보면 그 후보에 합친다. place가 null이면 '해당 없음'으로 닫는다.
 * 제안자는 리듀서가 그 메시지를 보낸 사람으로 채운다(고른 사람이 아니다).
 */
export function resolvePick(
  tripId: string,
  messageId: string,
  phrase: string,
  pick: { place: Place; existingSpotId?: string } | null,
): DispatchResult {
  const st = useTrips.getState();
  const doc = st.docs[tripId];
  const msg = doc?.messages.find((m) => m.id === messageId);
  if (!doc || !msg) return { ok: false, reason: '메시지를 찾을 수 없습니다' };
  if (!pick) return st.dispatch(tripId, { type: 'spot/resolveAmbiguous', messageId, phrase, spot: null });
  const { ids, clock } = getServices();
  const at = clock.now();
  const spot = spotFromPlace(pick.place, {
    id: ids.next('spot'),
    proposal: { memberId: msg.memberId, source: 'chat', messageId, at },
    createdAt: at,
    sourceText: msg.text,
    sourceMessageId: messageId,
  });
  return st.dispatch(tripId, {
    type: 'spot/resolveAmbiguous',
    messageId,
    phrase,
    spot,
    ...(pick.existingSpotId ? { mergeIntoSpotId: pick.existingSpotId } : {}),
  });
}
