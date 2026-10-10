import React, { useState } from 'react';
import { Platform, View } from 'react-native';

import type { LatLng, Trip } from '../../../types';
import { existingAddState, outsideConfirmText, type PickOption } from '../../../core/extract/manual';
import { josa } from '../../../core/util';
import { regionById } from '../../../data/regions';
import { MapCanvas } from '../../../components/map/MapCanvas';
import { myMemberId } from '../../../store/trips';
import { useUi } from '../../../store/ui';
import { Btn, ConfirmSheet, Field, Notice, Row, Sheet, SP } from '../../../ui';
import { addPlace, pickAtCoord, searchForManual, type SearchOutcome } from '../actions';
import { PlacePickSheet } from './PlacePickSheet';

/**
 * 스팟 수동 등록(FR-202, WP3 소유). 06 헤더 아래 검색 칸과 '지도에서 선택'.
 * - 검색 0건이면 앰버 안내 '결과 없음'. 여러 곳이면 24 선택 시트. 하나면 바로 담는다.
 * - 목적지 밖이면 확인 창 1회 뒤 담고 후보에 '목적지 밖'이 표시된다(자동 추출은 버린다).
 * - 지도에서 선택: MapCanvas onPressMap → places.at(누른 지점 300m 안 가장 가까운 장소). 기점 장소는 건너뛴다.
 * - 이미 내가 제안한 곳이면 아무것도 바꾸지 않고 '이미 제안한 곳'이라고 알린다. 직접 뺀 후보면 제외 스팟에 남는다고 알린다.
 * - 시트를 닫으면서 다른 시트를 열 때는 닫힘 애니메이션이 끝난 뒤 연다(iOS는 Modal 하나가 닫히는 중에 다른 Modal을 띄우지 못한다).
 */

/** 앞 시트가 닫힌 뒤 다음 시트를 여는 간격(ms). iOS만 기다린다. */
const MODAL_GAP_MS = Platform.OS === 'ios' ? 350 : 0;
function afterModal(fn: () => void) {
  if (MODAL_GAP_MS === 0) fn();
  else setTimeout(fn, MODAL_GAP_MS);
}
export function ManualAdd({ trip }: { trip: Trip }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [options, setOptions] = useState<PickOption[] | undefined>();
  const [confirm, setConfirm] = useState<PickOption | undefined>();
  const [mapOpen, setMapOpen] = useState(false);
  const toast = useUi((s) => s.showToast);
  const region = regionById(trip.region);

  const put = (opt: PickOption) => {
    const state = existingAddState(trip, opt, myMemberId(trip));
    if (state === 'already') {
      setNotice(`${josa(opt.place.name, '은/는')} 이미 제안한 곳입니다`);
      return;
    }
    const r = addPlace(trip.id, opt.place, opt.outside);
    if (!r.ok) {
      // 스토어도 토스트를 띄우지만, 검색 칸 아래에도 이유를 남겨 무엇이 안 됐는지 보이게 한다.
      setNotice(r.reason);
      return;
    }
    toast(
      state === 'removed'
        ? `${opt.place.name}에 제안을 더했습니다. 직접 뺀 후보라 제외 스팟에 남습니다. 후보 목록에서 되돌리기를 눌러 주세요`
        : state === 'merge'
          ? `${opt.place.name}에 제안을 더했습니다`
          : `${josa(opt.place.name, '을/를')} 후보에 담았습니다`,
    );
    setQuery('');
    setNotice(undefined);
  };

  /** fromSheet: 선택 시트나 지도 시트를 막 닫은 뒤라 확인 시트를 한 박자 늦게 연다. */
  const choose = (opt: PickOption, fromSheet = false) => {
    setOptions(undefined);
    if (!opt.outside) put(opt);
    else if (fromSheet) afterModal(() => setConfirm(opt));
    else setConfirm(opt);
  };

  const handle = (out: SearchOutcome, emptyText: string, fromSheet = false) => {
    if (out.kind === 'error') setNotice(out.text);
    else if (out.kind === 'none') setNotice(emptyText);
    else if (out.kind === 'one') {
      setNotice(undefined);
      choose(out.option, fromSheet);
    } else {
      setNotice(undefined);
      const options = out.options;
      if (fromSheet) afterModal(() => setOptions(options));
      else setOptions(options);
    }
  };

  const search = async () => {
    if (busy) return;
    setBusy(true);
    const out = await searchForManual(trip, query);
    setBusy(false);
    handle(out, `'${query.trim()}' 검색 결과가 없습니다. 이름을 바꿔 보거나 지도에서 골라 주세요`);
  };

  const onMap = async (coord: LatLng) => {
    setMapOpen(false);
    const out = await pickAtCoord(trip, coord);
    handle(out, '누른 곳 300m 안에 담을 수 있는 장소가 없습니다', true);
  };

  return (
    <View style={{ gap: SP.m }}>
      <Field
        label="장소 검색으로 담기"
        value={query}
        onChangeText={(v) => {
          setQuery(v);
          if (notice) setNotice(undefined);
        }}
        placeholder="예: 불국사, 황남빵"
        maxLength={40}
        // 키보드 엔터·검색 키로도 찾는다(검색 버튼과 같은 조건)
        onSubmitEditing={() => {
          if (!busy && query.trim().length >= 2) void search();
        }}
      />
      <Row gap={SP.m}>
        <View style={{ flex: 1 }}>
          <Btn title={busy ? '찾는 중' : '검색'} size="sm" icon="search" onPress={search} disabled={busy || query.trim().length < 2} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn title="지도에서 선택" size="sm" variant="quiet" icon="map" onPress={() => setMapOpen(true)} />
        </View>
      </Row>
      {notice ? <Notice tone="warn" icon="alert" text={notice} /> : null}

      <PlacePickSheet
        visible={!!options}
        title="어느 곳인가요?"
        options={options ?? []}
        onPick={(o) => choose(o, true)}
        onDismiss={() => setOptions(undefined)}
      />

      <ConfirmSheet
        visible={!!confirm}
        title="목적지 밖 장소입니다"
        text={confirm && region ? outsideConfirmText(confirm, region) : ''}
        confirmLabel="그래도 담기"
        onConfirm={() => {
          if (confirm) put(confirm);
          setConfirm(undefined);
        }}
        onCancel={() => setConfirm(undefined)}
      />

      <Sheet visible={mapOpen} onClose={() => setMapOpen(false)} title="지도에서 선택">
        <MapCanvas
          height={280}
          markers={trip.spots.map((s) => ({ id: s.id, coord: s.coord, kind: 'spot' as const, title: s.name }))}
          polylines={[]}
          fitTo={region ? [region.center, ...trip.spots.map((s) => s.coord)] : undefined}
          onPressMap={onMap}
        />
        <Btn title="닫기" variant="quiet" onPress={() => setMapOpen(false)} />
      </Sheet>
    </View>
  );
}
