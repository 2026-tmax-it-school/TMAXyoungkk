import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { itineraryFailText, toSampleTrip, countText } from '../core/itinerary';
import type { MapMarkerInput, MapPolylineInput } from '../core/map/layout';
import type { SharedItinerary } from '../core/ports';
import { MapCanvas } from '../components/map/MapCanvas';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { useItineraries } from '../store/itineraries';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { ArtHero, Body, Btn, Card, Chip, Col, ConfirmSheet, Empty, Foot, Header, Notice, Row, Screen, Seg, SP, Txt } from '../ui';

/**
 * 32 공유된 일정 상세(WP2 소유, 2026-10-17). 열면 조회수가 오른다(같은 사람은 하루 한 번).
 * - 일차 탭 · 지도(번호 핀, 점선은 실제 길이 아니다) · 장소 카드 · 조회/좋아요/가져옴 숫자.
 * - 좋아요(로그인 계정, 한 번만 · 다시 누르면 취소). '이 일정으로 여행방 만들기'는 만들기 화면(shared)을 연다.
 *   만들면 장소가 후보로 담기고 시간표가 짜이며, 그때 가져온 수가 오른다. 내 일정이면 '공유 내리기'(확인 1회)가 보인다.
 */
export default function ItineraryDetailScreen({ navigation, route }: RootScreenProps<'ItineraryDetail'>) {
  const { itineraryId } = route.params;
  const back = useBack('Home');
  const { open, like, remove, pick } = useItineraries();
  const session = useSession((s) => s.session);
  const [item, setItem] = useState<SharedItinerary | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [dayIndex, setDayIndex] = useState(0);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    void open(itineraryId).then((r) => {
      if (!alive) return;
      if (r.ok) setItem(r.value);
      else setProblem(itineraryFailText(r.code, r.detail));
    });
    return () => {
      alive = false;
    };
  }, [itineraryId, open]);

  const days = item?.days ?? [];
  const day = days[Math.min(dayIndex, Math.max(days.length - 1, 0))];

  const map = useMemo(() => {
    if (!day) return undefined;
    const markers: MapMarkerInput[] = day.places.map((p, i) => ({ id: `p${i}`, coord: p.coord, kind: 'spot', label: String(i + 1), title: p.name }));
    const coords = day.places.map((p) => p.coord);
    const polylines: MapPolylineInput[] = coords.length > 1 ? [{ id: 'day', coords, color: 'slate', dashed: true }] : [];
    return { markers, polylines, fitTo: coords };
  }, [day]);

  if (problem || !item) {
    return (
      <Screen>
        <Header back={back} title="공유된 일정" />
        <Body>{problem ? <Empty title="일정을 열지 못했어요" text={problem} /> : <Notice icon="clock" text="일정을 불러오는 중이에요" />}</Body>
      </Screen>
    );
  }

  const toggleLike = async () => {
    if (session?.kind !== 'account') {
      useUi.getState().showToast('로그인하면 좋아요를 누를 수 있어요', 'soft');
      return;
    }
    const r = await like(item.id, !item.liked);
    if (r.ok) setItem({ ...item, likes: r.value.likes, liked: r.value.liked, score: r.value.score });
    else useUi.getState().showToast(itineraryFailText(r.code, r.detail), 'warn');
  };

  const makeTrip = () => {
    const sample = toSampleTrip(item);
    if (!sample) return;
    pick(item.id, sample);
    navigation.navigate('CreateTrip', { regionId: item.regionId, shared: true });
  };

  const confirmRemove = async () => {
    setAsking(false);
    const r = await remove(item.id);
    useUi.getState().showToast(r.ok ? '공유를 내렸어요' : itineraryFailText(r.code, r.detail), r.ok ? 'soft' : 'warn');
    if (r.ok) navigation.goBack();
  };

  return (
    <Screen>
      <Body scroll flush>
        {/* 피그마 최종안 14: 지역 그림 머리(뒤로·좋아요 뜬 버튼), 아래 제목 */}
        <ArtHero
          regionId={item.regionId}
          onBack={back}
          right={{ icon: 'heart', label: item.liked ? '좋아요 취소' : '좋아요', onPress: () => void toggleLike() }}
        />
        <View style={{ gap: SP.xl, paddingHorizontal: SP.gutter }}>
        <Col gap={SP.xs}>
          <Txt v="eyebrow">{`${item.regionLabel || '국내'} · ${item.authorNickname}`}</Txt>
          <Txt v="ttl">{item.title}</Txt>
          {item.note ? <Txt v="mt">{item.note}</Txt> : null}
        </Col>
        <Row gap={SP.s} wrap>
          <Chip text={`${item.dayCount}일 · ${item.placeCount}곳`} tone="soft" icon="cal" />
          <Chip text={`조회 ${countText(item.views)}`} tone="line" />
          <Chip text={`좋아요 ${countText(item.likes)}`} tone="line" icon="heart" />
          <Chip text={`가져옴 ${countText(item.imports)}`} tone="line" />
        </Row>
        {item.tags.length > 0 ? <Txt v="mt">{item.tags.map((t) => `#${t}`).join(' ')}</Txt> : null}
        {days.length > 1 ? (
          <Seg<string> items={days.map((_, i) => ({ key: String(i), label: `${i + 1}일차` }))} value={String(dayIndex)} onChange={(k) => setDayIndex(Number(k))} />
        ) : null}
        {map && day ? (
          <>
            <MapCanvas height={220} markers={map.markers} polylines={map.polylines} fitTo={map.fitTo} />
            <Col gap={SP.m}>
              {day.places.map((p, i) => (
                <Card key={`${i}-${p.name}`}>
                  <Row top gap={SP.l}>
                    <View style={{ width: 24 }}>
                      <Txt v="time" c="accent">
                        {i + 1}
                      </Txt>
                    </View>
                    <Col grow gap={SP.xs}>
                      <Row gap={SP.s} wrap>
                        <Txt v="nm">{p.name}</Txt>
                        <Chip text={p.category} tone="line" />
                      </Row>
                      {p.note ? <Txt v="mt">{p.note}</Txt> : null}
                      {p.address ? <Txt v="mtTight">{p.address}</Txt> : null}
                    </Col>
                  </Row>
                </Card>
              ))}
            </Col>
          </>
        ) : null}
        <Txt v="mtTight">{item.mine ? '영업시간과 휴무일은 가기 전에 확인해 주세요.' : '다른 사람이 짠 일정이에요. 영업시간과 휴무일은 가기 전에 확인해 주세요.'}</Txt>
        </View>
      </Body>
      <Foot>
        <Btn title="이 일정으로 여행방 만들기" onPress={makeTrip} />
        <Row gap={SP.m}>
          <View style={{ flex: 1 }}>
            <Btn title={item.liked ? '좋아요 취소' : '좋아요'} icon="heart" variant="quiet" onPress={() => void toggleLike()} />
          </View>
          {item.mine ? (
            <View style={{ flex: 1 }}>
              <Btn title="공유 내리기" variant="quiet" onPress={() => setAsking(true)} />
            </View>
          ) : null}
        </Row>
      </Foot>
      <ConfirmSheet
        visible={asking}
        title="공유를 내릴까요?"
        text="다른 사람이 더는 이 일정을 볼 수 없어요. 이미 가져간 여행방은 그대로예요."
        confirmLabel="내리기"
        onConfirm={() => void confirmRemove()}
        onCancel={() => setAsking(false)}
      />
    </Screen>
  );
}
