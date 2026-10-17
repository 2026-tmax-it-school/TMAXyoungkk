import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import type { Place } from '../types';
import type { RecommendResult } from '../core/ports';
import { PROFILE_TAGS } from '../core/constants';
import { placeOfSpot } from '../core/extract/spot';
import { freeSlotsOfPlan, RECOMMEND_MAX, RECOMMEND_TAG_DEBOUNCE_MS } from '../core/recommend';
import { activeSpots } from '../core/spotUtil';
import { dateRange, josa } from '../core/util';
import { regionById } from '../data/regions';
import { addPlace } from '../features/candidates/actions';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { resultSource } from '../services/recommend';
import { getServices } from '../services/registry';
import { useSession } from '../store/session';
import { useTripDoc, useTrips } from '../store/trips';
import { useUi } from '../store/ui';
import { Body, Btn, Card, Chip, Col, Empty, Header, NotFound, Notice, Screen, SP, Tag, Txt } from '../ui';

/** 이 폭보다 좁으면(360 폰) 카드의 '후보에 담기'를 이름 옆이 아니라 카드 맨 아래 줄로 보낸다 */
const NARROW_W = 380;

const sameTags = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t) => b.includes(t));

/**
 * 23 여행지 추천(FR-404, 2차, WP3 소유).
 * - 입력: 여행방 지역·기간, 성향 태그(프로필에 저장한 값이 기본, 여기서 잠깐 바꿔 볼 수 있다), 기존 후보.
 * - 3~5곳. 기존 후보와 겹치지 않고 지역 안이다. 태그가 없거나 맞는 곳이 부족하면 인기 장소로 채우고 안내 한 줄을 둔다.
 * - 카드는 세 줄: 이름과 '후보에 담기'(spot/add) 또는 '후보에 담김', 종류·주소, 추천 이유.
 *   좁은 화면(360)에서는 버튼을 카드 맨 아래 줄로 보낸다.
 * - 추천은 온라인 기능이라 오프라인이면 새로 부르지 않는다(오프라인 안내는 앱 공통 OfflineBar).
 * - 요청마다 번호를 매겨 가장 최근 요청의 응답만 반영한다(태그를 빠르게 바꾸면 옛 응답이 새 결과를 덮지 않게).
 *   고르는 중에는 안내를 보이고 이전 결과의 버튼을 잠근다.
 * - 뒤로는 useBack('Candidates'), 없는 여행방은 NotFound('홈으로').
 * - AI 추천(2026-10-17): 결과 출처가 'ai'면 목록 위에 'AI 추천' 칩을 둔다. 로컬 점수로 대체되면 칩 없이 지금 그대로다.
 *   AI 맥락으로 기존 후보 이름과 계산된 일정의 빈 시간(freeSlotsOfPlan)을 함께 보낸다(채팅 글·멤버 이름은 보내지 않는다).
 * - 리뷰 반영(2026-10-17): 태그를 바꾸면 RECOMMEND_TAG_DEBOUNCE_MS 뒤에 부르고(첫 진입과 '다시 추천 받기'·'다시 시도'는 바로),
 *   새 요청이 앞 요청을 끊는다(AbortController). AI를 받지 못해 로컬로 대체된 결과(aiUnavailable)가 오면
 *   같은 태그의 AI 결과가 있으면 그것을 지키고 토스트로 알리며, 없으면 로컬 목록과 '다시 시도' 안내를 보인다.
 */
export default function RecommendScreen({ navigation, route }: RootScreenProps<'Recommend'>) {
  const { tripId } = route.params;
  const trip = useTripDoc(tripId);
  const online = useTrips((s) => s.online);
  const profileTags = useSession((s) => s.profile.tags);
  const toast = useUi((s) => s.showToast);
  const back = useBack('Candidates');
  const { width } = useWindowDimensions();
  const [tags, setTags] = useState<string[]>(profileTags);
  const [result, setResult] = useState<{ r: RecommendResult; tags: string[] } | undefined>();
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const reqNo = useRef(0);
  const ctl = useRef<AbortController | undefined>(undefined);
  const firstLoad = useRef(true);
  const current = useRef<{ r: RecommendResult; tags: string[] } | undefined>(undefined);
  current.current = result;
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
    ctl.current?.abort();
    const ac = typeof AbortController === 'function' ? new AbortController() : undefined;
    ctl.current = ac;
    setBusy(true);
    setLoadFailed(false);
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
        freeSlots: plan ? freeSlotsOfPlan(plan.days) : [],
        signal: ac?.signal,
      });
      if (no !== reqNo.current) return;
      const prev = current.current;
      if (r.aiUnavailable && prev && resultSource(prev.r) === 'ai' && prev.r.items.length > 0 && sameTags(prev.tags, asked)) {
        // 같은 태그의 좋은 AI 결과를 일시 실패로 덮지 않는다
        toast('지금은 AI 추천이 바빠요. 잠시 뒤 다시 시도해 주세요', 'warn');
        return;
      }
      setResult({ r, tags: asked });
    } catch {
      if (no !== reqNo.current) return;
      setLoadFailed(true);
      setResult(undefined);
    } finally {
      if (no === reqNo.current) setBusy(false);
    }
  }, [tripId, region?.id, online, tags.join('|')]);

  useEffect(() => {
    // 첫 진입은 바로, 태그를 바꾼 뒤는 잠깐 기다렸다가 부른다(빠른 연속 탭이 요청 여러 개가 되지 않게)
    const delay = firstLoad.current ? 0 : RECOMMEND_TAG_DEBOUNCE_MS;
    firstLoad.current = false;
    const timer = setTimeout(() => void load(), delay);
    return () => {
      // 화면을 떠나거나 조건이 바뀌면 기다리던 호출을 지우고 진행 중인 요청을 끊고 응답을 버린다.
      clearTimeout(timer);
      reqNo.current += 1;
      ctl.current?.abort();
    };
  }, [load]);

  if (!trip || !region) {
    return (
      <Screen>
        <Header back={back} title="AI 여행지 추천" />
        <Body>
          <NotFound title="여행방을 찾을 수 없어요" onHome={() => navigation.navigate('Main', { screen: 'Home' })} />
        </Body>
      </Screen>
    );
  }

  const narrow = width < NARROW_W;
  // AI를 받지 못해 로컬 목록을 보이는 중이면 실패 자리에서 맞는 이유와 '다시 시도'를 보인다(태그 부족 안내 대신)
  const aiDown = !loadFailed && !!result?.r.aiUnavailable;
  const failed = loadFailed || aiDown;
  const toggle = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const put = (place: Place) => {
    const r = addPlace(tripId, place, false);
    if (r.ok) toast(`${josa(place.name, '을/를')} 후보에 담았어요`);
  };

  return (
    <Screen>
      <Header back={back} eyebrow="AI 여행지 추천" title="이런 곳은 어때요" sub={region.name} />
      <Body scroll>
        <Col gap={SP.s}>
          <Txt v="label">성향 태그</Txt>
          <View style={styles.tags}>
            {PROFILE_TAGS.map((t) => (
              <Tag key={t} label={t} on={tags.includes(t)} onPress={() => toggle(t)} />
            ))}
          </View>
        </Col>

        {/* 상태 안내는 한 자리에 하나만 둔다(고르는 중 > 실패 > 인기 장소로 채움). 목록 위에 안내를 쌓지 않는다 */}
        {busy ? (
          <Notice icon="clock" text="추천을 고르는 중이에요" />
        ) : failed ? (
          <Notice
            tone="warn"
            icon="alert"
            text={aiDown ? 'AI 추천을 잠시 받지 못해 많이 찾는 곳을 보여 드려요' : '추천을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'}
            action={online ? { label: '다시 시도', onPress: () => void load() } : undefined}
          />
        ) : result?.r.fallback ? (
          <Notice
            title="인기 장소로 채웠어요"
            text={result.tags.length ? '태그와 맞는 곳이 부족해 많이 찾는 곳을 함께 보여 드려요.' : '태그가 없어 많이 찾는 곳을 보여 드려요.'}
          />
        ) : null}
        {!online && !result ? <Empty icon="compass" title="연결되면 추천을 불러와요" /> : null}
        {result && !busy && resultSource(result.r) === 'ai' && result.r.items.length > 0 ? (
          <View style={styles.source}>
            <Chip text="AI 추천" tone="ok" icon="compass" />
            <Txt v="mtTight">여행 정보를 바탕으로 AI가 고르고 실제 장소인지 확인했어요</Txt>
          </View>
        ) : null}

        {result
          ? result.r.items.map(({ place, reason }) => {
              const added = trip.spots.some((s) => s.placeId === place.placeId);
              const action = added ? (
                <Chip text="후보에 담김" tone="ok" icon="check" />
              ) : (
                <Btn title="후보에 담기" size="sm" variant="ghost" icon="plus" disabled={busy} onPress={() => put(place)} />
              );
              return (
                <Card key={place.placeId}>
                  <View style={styles.head}>
                    <View style={styles.name}>
                      <Txt v="nm" numberOfLines={2}>
                        {place.name}
                      </Txt>
                    </View>
                    {narrow ? null : action}
                  </View>
                  <Col gap={SP.xs}>
                    <Txt v="mtTight">{[place.kind ?? place.category, place.address].filter(Boolean).join(' · ')}</Txt>
                    {reason ? <Txt v="mt">{reason}</Txt> : null}
                  </Col>
                  {narrow ? <View style={styles.start}>{action}</View> : null}
                </Card>
              );
            })
          : null}
        {result && result.r.items.length === 0 ? <Empty title="추천할 곳이 없어요" text="태그를 바꿔 다시 받아 보세요." /> : null}
        <Btn title="다시 추천 받기" variant="quiet" onPress={() => void load()} disabled={!online || busy} />
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.s },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.m },
  name: { flex: 1, minWidth: 0 },
  start: { alignSelf: 'flex-start' },
  source: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SP.s },
});
