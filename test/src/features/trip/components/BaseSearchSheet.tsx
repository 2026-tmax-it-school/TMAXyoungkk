import React, { useState } from 'react';
import { ScrollView } from 'react-native';

import type { DayBase, Place } from '../../../types';
import type { Region } from '../../../core/ports';
import { getServices } from '../../../services/registry';
import { Btn, Field, Notice, SP, Sheet } from '../../../ui';
import { PickRow } from './PickerBox';

/**
 * 기점 검색 시트(FR-201·205). 장소 검색은 PlaceProvider(키 없으면 로컬 사전, 카카오 키가 있으면 카카오 · 가정)다.
 * 기점은 선택 입력이다. 검색 결과가 0건이면 '결과 없음'을 알리고 기점 없이 둘 수 있다(그날 첫 스팟이 기점).
 */
export function BaseSearchSheet({
  visible,
  region,
  onClose,
  onPick,
  noneLabel = '기점 없이 두기(첫 스팟 사용)',
}: {
  visible: boolean;
  region?: Region;
  onClose: () => void;
  /** place는 고른 검색 결과(분류 표시용). 기점 없이 두면 없다 */
  onPick: (base: DayBase | null, place?: Place) => void;
  noneLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const search = async () => {
    const q = query.trim();
    if (!q || !region) return;
    setBusy(true);
    setError(undefined);
    try {
      const found = await getServices().places.search(q, region, region.center);
      setResults(found);
    } catch {
      setResults(undefined);
      setError('장소 검색에 실패했습니다. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setResults(undefined);
    setError(undefined);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={close} title="기점 찾기">
      {region ? null : <Notice tone="warn" text="지역을 먼저 골라 주세요." />}
      <Field
        label={`숙소나 출발할 곳 · ${region?.name ?? ''}`}
        value={query}
        onChangeText={setQuery}
        placeholder="예: 라한셀렉트 경주, 경주역"
        // 키보드 엔터·검색 키로도 찾는다(2026-10-09 웹 실행: 엔터를 눌러도 아무 일이 없었다)
        onSubmitEditing={() => {
          if (!busy) void search();
        }}
      />
      <Btn title={busy ? '찾는 중' : '검색'} size="sm" variant="ghost" icon="search" disabled={busy || !query.trim() || !region} onPress={search} />
      {error ? <Notice tone="warn" icon="alert" text={error} /> : null}
      {results && results.length === 0 ? (
        <Notice icon="search" title="결과 없음" text={`'${query.trim()}'에 맞는 장소가 없습니다.`} />
      ) : null}
      {results && results.length > 0 ? (
        <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: SP.m }}>
          {results.map((p) => (
            <PickRow
              key={p.placeId}
              icon="pin"
              title={p.name}
              sub={[p.category, p.address].filter(Boolean).join(' · ')}
              onPress={() => {
                onPick({ name: p.name, coord: p.coord, placeId: p.placeId }, p);
                close();
              }}
            />
          ))}
        </ScrollView>
      ) : null}
      <Btn
        title={noneLabel}
        variant="quiet"
        size="sm"
        onPress={() => {
          onPick(null);
          close();
        }}
      />
    </Sheet>
  );
}
