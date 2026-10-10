import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { Place } from '../types';
import type { RecommendResult } from '../core/ports';
import { PROFILE_TAGS } from '../core/constants';
import { placeOfSpot } from '../core/extract/spot';
import { RECOMMEND_MAX } from '../core/recommend';
import { activeSpots } from '../core/spotUtil';
import { dateRange, josa } from '../core/util';
import { regionById } from '../data/regions';
import { addPlace } from '../features/candidates/actions';
import type { RootScreenProps } from '../navigation/routes';
import { resultSource } from '../services/recommend';
import { getServices } from '../services/registry';
import { useSession } from '../store/session';
import { useTripDoc, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import {
  Body,
  Btn,
  Card,
  Chip,
  Col,
  Empty,
  Header,
  Notice,
  Row,
  Screen,
  ScopeBadge,
  SP,
  Tag,
  Txt,
} from '../ui';

/**
 * 23 여행지 추천(FR-404, 2차, WP3 소유).
 * - 입력: 여행방 지역·기간, 성향 태그(프로필에 저장한 값이 기본, 여기서 잠깐 바꿔 볼 수 있다), 기존 후보.
 * - 3~5곳. 기존 후보와 겹치지 않고 지역 안이다. 태그가 없거나 맞는 곳이 부족하면 인기 장소로 대체하고 '대체됨'을 단다.
 * - 곳마다 추천 이유 한 줄과 '후보에 담기'(spot/add). 추천은 온라인 기능이라 오프라인이면 비활성이다.
 * - 요청마다 번호를 매겨 가장 최근 요청의 응답만 반영한다(태그를 빠르게 바꾸면 옛 응답이 새 결과를 덮지 않게).
 *   '대체됨' 칩은 그 결과를 요청할 때의 태그로 판정한다. '예시 데이터' 칩은 결과 출처(AI 실패 시 로컬 대체 포함)로 정한다.
 */
export default function RecommendScreen({ navigation, route }: RootScreenProps<'Recommend'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const online = useTrips((s) => s.online);
  const profileTags = useSession((s) => s.profile.tags);
  const toast = useUi((s) => s.showToast);
  const [tags, setTags] = useState<string[]>(profileTags);
  const [result, setResult] = useState<{ r: RecommendResult; tags: string[] } | undefined>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const reqNo = useRef(0);
  const back = navigation.canGoBack() ? navigation.goBack : undefined;
  const region = trip ? regionById(trip.region) : undefined;

  const load = useCallback(async () => {
    // 지금 후보를 스토어에서 바로 읽는다. 담을 때마다 다시 부르지 않고 담긴 곳은 '후보에 담김'으로 남긴다.
    const doc = useTrips.getState().docs[tripId];
    if (!doc || !region || !online) {
      setBusy(false);
      return;
    }
    const no = ++reqNo.current;
    const asked = [...tags];
    setBusy(true);
    setFailed(false);
    try {
      // 근접도 기준점은 확정 스팟 좌표다(계산 결과가 없으면 제공자가 지역 안 기존 후보로 잡는다).
      const plan = useTrips.getState().plans[tripId];
      const confirmed = new Set(plan?.days.flatMap((d) => d.items.map((i) => i.spotId)) ?? []);
      const anchor = activeSpots(doc)
        .filter((s) => confirmed.has(s.id))
        .map((s) => s.coord);
      const r = await getServices().recommend.recommend({
        region,
        dates: dateRange(doc.startDate, doc.endDate),
        tags: asked,
        existing: doc.spots.map(placeOfSpot),
        limit: RECOMMEND_MAX,
        anchor,
      });
      if (no !== reqNo.current) return;
      setResult({ r, tags: asked });
    } catch {
      if (no !== reqNo.current) return;
      setFailed(true);
      setResult(undefined);
    } finally {
      if (no === reqNo.current) setBusy(false);
    }
  }, [tripId, region?.id, online, tags.join('|')]);

  useEffect(() => {
    void load();
    return () => {
      // 화면을 떠나거나 조건이 바뀌면 진행 중인 응답을 버린다.
      reqNo.current += 1;
    };
  }, [load]);

  if (!trip || !region) {
    return (
      <Screen>
        <Header back={back} title="여행지 추천" />
        <Body>
          <Empty title="여행방을 찾을 수 없습니다" />
        </Body>
      </Screen>
    );
  }

  const sample = result ? resultSource(result.r) === 'local' : getServices().recommend.id === 'local';
  const toggle = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const put = (place: Place) => {
    const r = addPlace(tripId, place, false);
    if (r.ok) toast(`${josa(place.name, '을/를')} 후보에 담았습니다`);
  };

  return (
    <Screen>
      <Header
        back={back}
        eyebrow="여행지 추천"
        title="이런 곳은 어때요"
        sub={region.name}
        right={
          <Row gap={SP.s}>
            <ScopeBadge phase="2차" />
          </Row>
        }
      />
      <Body scroll>
        <Col gap={SP.s}>
          <Txt v="label">성향 태그</Txt>
          <Row wrap gap={SP.s}>
            {PROFILE_TAGS.map((t) => (
              <Tag key={t} label={t} on={tags.includes(t)} onPress={() => toggle(t)} />
            ))}
          </Row>
        </Col>

        {!online ? (
          <Notice tone="warn" icon="alert" title="오프라인" text="추천은 온라인에서만 됩니다. 연결되면 다시 불러옵니다." />
        ) : null}
        {failed ? <Notice tone="warn" icon="alert" text="추천을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요." /> : null}
        {result?.r.fallback ? (
          <Notice
            title="인기 장소로 대체됨"
            text={result.tags.length ? '태그와 맞는 곳이 부족해 많이 찾는 곳으로 채웠습니다.' : '태그가 없어 많이 찾는 곳을 보여줍니다.'}
          />
        ) : null}
        {busy ? <Txt v="mt">추천을 고르는 중입니다</Txt> : null}

        {online && result
          ? result.r.items.map(({ place }) => {
              const added = trip.spots.some((s) => s.placeId === place.placeId);
              return (
                <Card key={place.placeId}>
                  <Row top>
                    <Col grow gap={SP.xs}>
                      <Txt v="nm">{place.name}</Txt>
                      <Txt v="mtTight">{[place.kind ?? place.category, place.address].filter(Boolean).join(' · ')}</Txt>
                    </Col>
                    {result.r.fallback && !(place.tags ?? []).some((t) => result.tags.includes(t)) ? <Chip text="대체됨" tone="line" /> : null}
                  </Row>
                  <View style={{ alignSelf: 'flex-start' }}>
                    {added ? (
                      <Chip text="후보에 담김" tone="ok" icon="check" />
                    ) : (
                      <Btn title="후보에 담기" size="sm" variant="ghost" icon="plus" onPress={() => put(place)} />
                    )}
                  </View>
                </Card>
              );
            })
          : null}
        {online && result && result.r.items.length === 0 ? (
          <Empty title="추천할 곳이 없습니다" />
        ) : null}
        <Btn title="다시 추천 받기" variant="quiet" onPress={() => void load()} disabled={!online || busy} />
      </Body>
    </Screen>
  );
}
