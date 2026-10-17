import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { SEARCH_MAX, SORT_LABEL, countText, itineraryFailText } from '../core/itinerary';
import type { ItinerarySort, SharedItinerary } from '../core/ports';
import type { RootScreenProps } from '../navigation/routes';
import { useBack } from '../navigation/useBack';
import { getServices } from '../services/registry';
import { useItineraries } from '../store/itineraries';
import { Btn, Card, Chip, Col, Empty, Field, Header, IconBtn, Notice, Row, Screen, Seg, SP, Txt } from '../ui';

/** 글자를 멈추고 이만큼 지나면 검색한다(엔터·검색 버튼은 바로) */
const SEARCH_DEBOUNCE_MS = 400;

/**
 * 31 공유된 여행 일정(WP2 소유, 2026-10-17). 다른 사람이 다녀온 일정을 둘러보고 마음에 들면 내 여행방으로 가져온다.
 * - 정렬: 인기순(가져오기×5 + 좋아요×3 + 조회) · 최신순 · 조회순. 제목·지역·태그 검색(0.4초 뒤).
 * - 카드: 이름, 지역, 며칠 몇 곳, 태그, 조회·좋아요·가져옴 숫자, 올린 사람. 누르면 상세(ItineraryDetail).
 * - 목록은 FlatList. 당겨서 새로 고치고, 끝에 닿으면 이어 받는다. 서버 주소가 없으면 이 기기 모의라고 안내한다.
 */
export default function ItinerariesScreen({ navigation, route }: RootScreenProps<'Itineraries'>) {
  const back = useBack('Home');
  return (
    <Screen>
      <Header back={back} eyebrow="다른 사람의 여행" title="공유된 여행 일정" right={<IconBtn icon="refresh" label="새로 고침" onPress={() => void useItineraries.getState().refresh()} />} />
      <ItineraryFeed navigation={navigation} region={route.params?.region ?? null} />
    </Screen>
  );
}

/**
 * 공유된 일정 목록(검색·정렬·카드·이어 받기). 커뮤니티 탭의 '여행 일정' 탭(2026-10-17)과 이 화면이 같이 쓴다.
 * 머리말·Screen은 부르는 쪽이 둔다.
 */
export function ItineraryFeed({
  navigation,
  region,
  onShare,
}: {
  navigation: { navigate: (name: 'ItineraryDetail', params: { itineraryId: string }) => void };
  region: string | null;
  /** 있으면 빈 목록에 '내 일정 공유하기' 버튼을 보인다(커뮤니티 탭) */
  onShare?: () => void;
}) {
  const { items, next, sort, query, status, loadingMore, error, setSort, setQuery, setRegion, refresh, more } = useItineraries();
  const [text, setText] = useState(query);
  const local = getServices().itineraries.id === 'local';

  useEffect(() => {
    setRegion(region);
  }, [region, setRegion]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  useEffect(() => {
    const t = setTimeout(() => setQuery(text), text.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [text, setQuery]);

  const head = (
    <Col gap={SP.xl}>
      {local ? <Notice icon="alert" title="이 기기에서만 보여요" text="서버 주소가 없어서 모의로 돌아가요. 앱을 새로 열면 공유한 일정이 사라져요." /> : null}
      <Row gap={SP.s}>
        <View style={{ flex: 1 }}>
          <Field
            label="검색"
            hideLabel
            size="sm"
            value={text}
            onChangeText={(v) => setText(v.slice(0, SEARCH_MAX))}
            placeholder="제목, 지역, 태그로 검색"
            onSubmitEditing={() => setQuery(text)}
          />
        </View>
        {text ? <IconBtn icon="x" label="검색어 지우기" onPress={() => setText('')} /> : <IconBtn icon="search" label="검색" onPress={() => setQuery(text)} />}
      </Row>
      <Seg<ItinerarySort>
        items={(Object.keys(SORT_LABEL) as ItinerarySort[]).map((k) => ({ key: k, label: SORT_LABEL[k] }))}
        value={sort}
        onChange={setSort}
      />
      {status === 'error' ? (
        <Col gap={SP.m}>
          <Notice tone="warn" icon="alert" title="일정을 불러오지 못했어요" text={itineraryFailText(error ?? '')} />
          <Btn title="다시 불러오기" size="sm" variant="quiet" onPress={() => void refresh()} />
        </Col>
      ) : null}
      {status === 'loading' && items.length === 0 ? <Notice icon="clock" text="일정을 불러오는 중이에요" /> : null}
    </Col>
  );

  const empty =
    status === 'ready' ? (
      query ? (
        <Empty icon="search" title={`'${query}' 검색 결과가 없어요`} text="제목, 지역, 태그를 다른 말로 찾아 보세요" action={{ label: '검색 지우기', onPress: () => setText('') }} />
      ) : (
        <Empty
          icon="share"
          title="아직 공유된 일정이 없어요"
          text="내 여행 일정을 처음으로 공유해 보세요"
          action={onShare ? { label: '내 일정 공유하기', onPress: onShare } : undefined}
        />
      )
    ) : null;

  const foot = (
    <View style={{ paddingBottom: SP.section * 2 }}>
      {loadingMore ? <Notice icon="clock" text="일정을 더 불러오는 중이에요" /> : null}
      {!next && items.length > 0 && status === 'ready' ? <Txt v="mtTight">일정을 모두 봤어요</Txt> : null}
    </View>
  );

  return (
    <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <ItineraryCard item={item} onPress={() => navigation.navigate('ItineraryDetail', { itineraryId: item.id })} />}
        ListHeaderComponent={head}
        ListEmptyComponent={empty}
        ListFooterComponent={foot}
        contentContainerStyle={{ paddingHorizontal: SP.gutter, gap: SP.xl }}
        refreshControl={<RefreshControl refreshing={status === 'loading' && items.length > 0} onRefresh={() => void refresh()} />}
        keyboardShouldPersistTaps="handled"
        onEndReached={() => void more()}
        onEndReachedThreshold={0.5}
    />
  );
}

/** 목록 카드 한 장 */
export function ItineraryCard({ item, onPress }: { item: SharedItinerary; onPress: () => void }) {
  return (
    <Card onPress={onPress}>
      <Col gap={SP.s}>
        <Row gap={SP.s} wrap>
          <Chip text={item.regionLabel || '국내'} tone="soft" icon="pin" />
          <Chip text={`${item.dayCount}일 · ${item.placeCount}곳`} tone="line" />
          {item.mine ? <Chip text="내 일정" tone="line" /> : null}
        </Row>
        <Txt v="nm">{item.title}</Txt>
        {item.note ? (
          <Txt v="mt" c="muted">
            {item.note}
          </Txt>
        ) : null}
        {item.tags.length > 0 ? <Txt v="mtTight">{item.tags.map((t) => `#${t}`).join(' ')}</Txt> : null}
        <Txt v="mtTight">
          {`조회 ${countText(item.views)} · 좋아요 ${countText(item.likes)} · 가져옴 ${countText(item.imports)} · ${item.authorNickname}`}
        </Txt>
      </Col>
    </Card>
  );
}
