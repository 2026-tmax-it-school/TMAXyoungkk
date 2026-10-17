import React, { useMemo, useState } from 'react';

import { NOTE_MAX, TITLE_MAX, itineraryFailText, shareCounts, shareDays, shareDraft } from '../core/itinerary';
import { TAGS_MAX, cleanTags } from '../core/community';
import { regionById } from '../data/regions';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { useItineraries } from '../store/itineraries';
import { useSession } from '../store/session';
import { usePlan, useTripDoc } from '../store/trips';
import { useUi } from '../store/ui';
import { Body, Btn, Card, Chip, Col, Empty, Field, Foot, Header, Notice, Row, Screen, SP, Txt } from '../ui';

/**
 * 33 내 일정 공유하기(WP2 소유, 2026-10-17). 여행방의 날짜별 장소(시간표 순서)를 올려 다른 사람이 보고 가져가게 한다.
 * - 올라가는 것: 일정 이름·소개·태그, 날짜별 장소의 이름·분류·주소·좌표. 채팅·멤버·사진·메모·날짜는 올라가지 않는다.
 * - 이름은 여행방 이름이 처음 값이다. 태그는 띄어쓰기로 나눠 5개까지. 로그인한 계정만 올린다(게스트는 안내).
 * - 올리면 방금 올린 일정 상세로 간다. 한 시간에 10개까지.
 */
export default function ShareItineraryScreen({ navigation, route }: RootScreenProps<'ShareItinerary'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const plan = usePlan(tripId);
  const session = useSession((s) => s.session);
  const back = useBack('Home');
  const share = useItineraries((s) => s.share);
  const [title, setTitle] = useState(trip?.title ?? '');
  const [note, setNote] = useState('');
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);

  const tags = useMemo(() => cleanTags(tagText.split(/[\s,#，、]+/).filter(Boolean)), [tagText]);
  const days = useMemo(() => (trip ? shareDays(trip, plan) : []), [trip, plan]);

  if (!trip) {
    return (
      <Screen>
        <Header back={back} title="일정 공유하기" />
        <Body>
          <Empty title="여행방을 찾지 못했어요" />
        </Body>
      </Screen>
    );
  }

  const region = regionById(trip.region);
  const counts = shareCounts(days);
  const { draft, problem } = shareDraft(trip, plan, { title, note, tags }, region?.name ?? '국내');
  const account = session?.kind === 'account';

  const submit = async () => {
    if (busy || problem || !account) return;
    setBusy(true);
    const r = await share(draft);
    setBusy(false);
    if (!r.ok) {
      useUi.getState().showToast(itineraryFailText(r.code, r.detail), 'warn');
      return;
    }
    useUi.getState().showToast('일정을 공유했어요', 'soft');
    navigation.replace('ItineraryDetail', { itineraryId: r.value.id });
  };

  return (
    <Screen keyboard>
      <Header back={back} eyebrow={trip.title} title="내 일정 공유하기" />
      <Body scroll>
        {!account ? <Notice icon="alert" title="로그인이 필요해요" text="계정으로 로그인하면 내 일정을 공유할 수 있어요. 게스트는 다른 사람의 일정을 보고 가져오기만 돼요." /> : null}
        <Row gap={SP.s} wrap>
          <Chip text={region?.name ?? '국내'} tone="soft" icon="pin" />
          <Chip text={`${counts.days}일 · ${counts.places}곳`} tone="line" />
        </Row>
        <Field label="일정 이름" value={title} onChangeText={(v) => setTitle(v.slice(0, TITLE_MAX))} maxLength={TITLE_MAX} placeholder="예: 경주 한옥 2박 3일" />
        <Field label="소개 (선택)" value={note} onChangeText={(v) => setNote(v.slice(0, NOTE_MAX))} maxLength={NOTE_MAX} multiline placeholder="어떤 여행이었는지 짧게 적어 주세요" />
        <Field
          label="태그 (선택)"
          value={tagText}
          onChangeText={setTagText}
          placeholder="#한옥 #야경 (띄어쓰기로 나눠요)"
          help={tags.length > 0 ? tags.map((t) => `#${t}`).join(' ') : `${TAGS_MAX}개까지`}
        />
        {days.map((d, i) => (
          <Card key={d.title + i}>
            <Col gap={SP.xs}>
              <Txt v="nm">{d.title}</Txt>
              <Txt v="mt" c="muted">
                {d.places.map((p) => p.name).join(', ')}
              </Txt>
            </Col>
          </Card>
        ))}
        {days.length === 0 ? <Notice icon="alert" text="장소를 한 곳 이상 담은 뒤에 공유할 수 있어요" /> : null}
        <Txt v="mtTight">올라가는 것은 장소 이름·분류·주소·위치뿐이에요. 채팅, 멤버, 사진, 날짜는 올라가지 않아요.</Txt>
      </Body>
      <Foot>
        <Btn title={busy ? '공유하는 중' : '일정 공유하기'} onPress={() => void submit()} disabled={busy || !!problem || !account} />
        {problem && account ? <Txt v="mtTight">{problem}</Txt> : null}
      </Foot>
    </Screen>
  );
}
