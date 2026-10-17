import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { josa, kstDate } from '../../core/util';
import { appClock } from '../../services/clock';
import { getServices } from '../../services/registry';
import type { Region } from '../../core/ports';
import type { Place } from '../../types';
import { Chip, Col, ListRow, Notice, SectionTitle, SP, Txt } from '../../ui';
import { mergeRegionHits, searchRegions, type RegionHit } from './homeSearch';

/** 적기를 멈추고 이만큼 지나면 지역 검색·AI 추천을 묻는다(한 글자마다 서버에 묻지 않게) */
const ASK_DELAY_MS = 500;
const AI_LIMIT = 5;

/**
 * 홈 검색의 지역·AI 추천 결과(내 여행방 결과는 홈이 카드 줄로 거른다). features/account/homeSearch가 판단한다.
 * - 지역: 목록 지역 + 지역 검색(카카오 주소, 목록 밖 시·군). 줄을 누르면 예시 일정(있으면) 또는 여행방 만들기
 * - AI 추천 여행지: 첫 지역으로 services recommend(AI 프록시, 실패하면 로컬 추천)를 묻는다. 로컬이면 '예시 추천' 칩
 */
export function HomeSearchResults({
  query,
  onRegion,
  onCreate,
}: {
  query: string;
  /** 지역 줄: 예시 일정이 있으면 그 화면, 없으면 여행방 만들기 */
  onRegion: (hit: RegionHit) => void;
  /** AI 추천 아래 '이 지역으로 여행방 만들기' */
  onCreate: (regionId: string) => void;
}) {
  const listed = searchRegions(query);
  const [searched, setSearched] = useState<Region[]>([]);
  const [ai, setAi] = useState<{ regionId: string; items: { place: Place; reason: string }[]; local: boolean } | 'loading' | 'error' | undefined>(undefined);

  // 지역 검색(목록 밖 시·군). 검색어가 바뀌면 이전 결과는 버린다
  useEffect(() => {
    setSearched([]);
    const q = query.trim();
    if (q.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      getServices()
        .regions.search(q, 3)
        .then((rs) => alive && setSearched(rs))
        .catch(() => undefined);
    }, ASK_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  const regions = mergeRegionHits(listed, searched);
  const first = regions[0]?.region;

  // AI 추천: 첫 지역이 바뀔 때마다 새로 묻고, 이전 요청은 끊는다
  useEffect(() => {
    setAi(undefined);
    if (!first) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setAi('loading');
      getServices()
        .recommend.recommend({ region: first, dates: [kstDate(appClock().now())], tags: [], existing: [], limit: AI_LIMIT, signal: ctrl.signal })
        .then((r) => {
          if (ctrl.signal.aborted) return;
          setAi({ regionId: first.id, items: r.items.slice(0, AI_LIMIT), local: r.source !== 'ai' });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setAi('error');
        });
    }, ASK_DELAY_MS);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [first?.id]);

  return (
    <Col gap={SP.section}>
      <View style={{ gap: SP.m }}>
        <SectionTitle title="지역" />
        {regions.length === 0 ? (
          <Txt v="mtTight">{`'${query.trim()}' 지역을 찾지 못했어요`}</Txt>
        ) : (
          regions.map((h, i) => (
            <ListRow
              key={h.region.id}
              first={i === 0}
              icon="pin"
              label={h.region.name}
              sub={h.hasSample ? `${h.region.label} · 예시 2박 3일 일정 보기` : `${h.region.label} · 이 지역으로 여행방 만들기`}
              onPress={() => onRegion(h)}
            />
          ))
        )}
      </View>

      {first ? (
        <View style={{ gap: SP.m }}>
          <SectionTitle title={`${first.name} AI 추천 여행지`} />
          {ai === 'loading' || ai === undefined ? (
            <Notice icon="clock" text="AI가 여행지를 고르는 중이에요" />
          ) : ai === 'error' ? (
            <Notice tone="warn" icon="alert" text="추천을 받지 못했어요. 잠시 뒤 다시 검색해 주세요" />
          ) : ai.items.length === 0 ? (
            <Txt v="mtTight">추천할 곳을 찾지 못했어요</Txt>
          ) : (
            <>
              {ai.local ? (
                <View style={{ alignSelf: 'flex-start' }}>
                  <Chip text="예시 추천" tone="line" />
                </View>
              ) : null}
              {ai.items.map((it, i) => (
                <ListRow
                  key={it.place.placeId}
                  first={i === 0}
                  icon="compass"
                  label={it.place.name}
                  sub={`${it.place.category} · ${it.reason}`}
                />
              ))}
              <ListRow icon="plus" label={`${josa(first.name, '으로/로')} 여행방 만들기`} onPress={() => onCreate(first.id)} />
            </>
          )}
        </View>
      ) : null}
    </Col>
  );
}
