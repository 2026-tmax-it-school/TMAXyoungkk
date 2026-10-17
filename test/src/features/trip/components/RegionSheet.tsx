import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import type { LatLng } from '../../../types';
import type { Region } from '../../../core/ports';
import type { MapMarkerInput } from '../../../core/map/layout';
import { josa } from '../../../core/util';
import { MapCanvas } from '../../../components/map/MapCanvas';
import { regionById } from '../../../data/regions';
import { getServices } from '../../../services/registry';
import { Btn, Field, SP, Sheet, Txt } from '../../../ui';
import { PickRow } from './PickerBox';

/**
 * 지역 선택(FR-201, 2026-10-10 개편). 국내 시·군을 검색하거나 지도를 눌러 고른다.
 * - 검색: '익산'처럼 치면 잠깐 멈춘 뒤(300ms) 카카오 주소 검색으로 시·군을 찾고, 첫 결과를 지도에 마커로 찍는다
 *   (services/regions). 목록에 없는 지역은 이름·중심·반경을 담은 geo: id가 된다(data/regions encodeRegionId).
 * - 지도: 누른 지점이 속한 시·군을 찾아 마커를 옮긴다.
 * - 결과를 눌러도 마커만 옮기고, 아래 버튼으로 정한다. 검색 전에는 목록을 두지 않는다(지도와 버튼만).
 * 카카오를 못 쓰면 목록 지역 안에서만 찾는다. 해외는 로드맵이라 없다.
 */

const SEARCH_DEBOUNCE_MS = 300;
const MAP_H = 200;
/** 아무것도 고르지 않았을 때 지도에 담는 범위(국토 전체) */
const KOREA_FIT: LatLng[] = [
  { latitude: 33.1, longitude: 125.0 },
  { latitude: 38.6, longitude: 130.0 },
];

/** 지역 반경만큼의 네모(지도가 그 시·군 전체를 담게 한다). 한 점만 주면 지도가 거리 단위로 확대된다 */
export function regionFit(r: Region): LatLng[] {
  const dLat = r.radiusKm / 111;
  const dLng = r.radiusKm / (111 * Math.cos((r.center.latitude * Math.PI) / 180));
  return [
    { latitude: r.center.latitude - dLat, longitude: r.center.longitude - dLng },
    { latitude: r.center.latitude + dLat, longitude: r.center.longitude + dLng },
  ];
}

export function RegionSheet({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  value?: string;
  onClose: () => void;
  onPick: (regionId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Region[] | undefined>(undefined);
  const [picked, setPicked] = useState<Region | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const seq = useRef(0);

  // 열 때마다 지금 값에서 시작한다
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setFound(undefined);
    setNote(undefined);
    setPicked(value ? regionById(value) : undefined);
  }, [visible, value]);

  // 검색: 잠깐 멈추면 묻고, 첫 결과를 지도에 찍는다. 늦게 온 앞 응답은 버린다
  useEffect(() => {
    if (!visible) return;
    const q = query.trim();
    if (!q) {
      seq.current += 1;
      setFound(undefined);
      setBusy(false);
      return;
    }
    const my = ++seq.current;
    const t = setTimeout(() => {
      setBusy(true);
      void getServices()
        .regions.search(q)
        .catch(() => [] as Region[])
        .then((rs) => {
          if (my !== seq.current) return;
          setFound(rs);
          setBusy(false);
          setNote(rs.length === 0 ? `'${q}'에 맞는 국내 지역이 없습니다.` : undefined);
          if (rs[0]) setPicked(rs[0]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, visible]);

  const onPressMap = (coord: LatLng) => {
    const my = ++seq.current;
    setBusy(true);
    void getServices()
      .regions.at(coord)
      .catch(() => undefined)
      .then((r) => {
        if (my !== seq.current) return;
        setBusy(false);
        if (r) {
          setPicked(r);
          setNote(undefined);
        } else setNote('이 지점의 국내 시·군을 찾지 못했습니다.');
      });
  };

  const markers = useMemo<MapMarkerInput[]>(
    () => (picked ? [{ id: 'region', coord: picked.center, kind: 'spot', label: '지역', color: 'ink', title: picked.label }] : []),
    [picked],
  );
  const fitTo = useMemo(() => (picked ? regionFit(picked) : KOREA_FIT), [picked]);
  const list = found ?? [];

  return (
    <Sheet visible={visible} onClose={onClose} title="지역 고르기">
      <Field label="지역 검색" value={query} onChangeText={setQuery} />
      {visible ? (
        <View style={{ height: MAP_H }}>
          <MapCanvas height={MAP_H} markers={markers} polylines={[]} fitTo={fitTo} onPressMap={onPressMap} wheelZoom />
        </View>
      ) : null}
      {busy || note ? <Txt v="mtTight">{busy ? '찾는 중' : note}</Txt> : null}
      {list.length > 0 ? (
        <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ gap: SP.m }} keyboardShouldPersistTaps="handled">
          {list.map((r) => (
            <PickRow key={r.id} icon="pin" title={r.name} sub={r.label} on={r.id === picked?.id} onPress={() => setPicked(r)} />
          ))}
        </ScrollView>
      ) : null}
      <Btn
        title={picked ? `${josa(picked.name, '으로/로')} 정하기` : '지역을 골라 주세요'}
        disabled={!picked}
        onPress={() => {
          if (!picked) return;
          onPick(picked.id);
          onClose();
        }}
      />
    </Sheet>
  );
}
