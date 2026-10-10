import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { LatLng } from '../../types';
import type { MapDotInput, MapMarkerInput, MapPolylineInput } from '../../core/map/layout';
import type { LocateMode } from '../../core/map/locate';
import { locateLabel } from '../../core/map/locate';
import { Btn, E, Icon, iconC, lineC, mapC, Row, Sheet, SP, surfaceC, Txt } from '../../ui';

/**
 * 지도 공통 조각(WP5 소유). 기본 지도(MapCanvas SVG)와 카카오·구글 지도가 같이 쓴다.
 * props 모양이 같아서 화면은 어느 지도인지 모른다.
 */

export interface MapCanvasProps {
  markers: MapMarkerInput[];
  polylines: MapPolylineInput[];
  dots?: MapDotInput[];
  user?: { coord: LatLng; accuracyM: number | null };
  fitTo?: LatLng[];
  compact?: boolean;
  height?: number;
  onMarkerPress?: (id: string) => void;
  onPressMap?: (coord: LatLng) => void;
  /** 모서리·테두리 없이 화면 가득(11·13 지도 탭) */
  flat?: boolean;
  /**
   * 웹에서 그냥 마우스 휠로 확대·축소한다(flat 지도와 같은 손짓). 스크롤할 페이지가 없는 곳(바닥 시트 안 지도)에서 켠다.
   * 끄면(기본) 스크롤 화면 안의 지도는 Ctrl·Cmd+휠, 더블클릭, 두 손가락으로만 확대한다(페이지 스크롤을 막지 않게)
   */
  wheelZoom?: boolean;
  /** 지도 위에 띄우는 칩·버튼(절대 배치) */
  children?: React.ReactNode;
  /** 지도 아래쪽을 덮는 요소(11 하단 시트) 높이. '전체 보기' 버튼을 그만큼 올린다 */
  overlayBottom?: number;
  /**
   * 오른쪽 아래 '내 위치' 버튼(11 지도 탭, 27 길찾기). 누를 때만 위치를 읽는다(useMyLocation). 미리보기(compact)에는 없다.
   * 화면이 user(여행 진행 중 위치)를 주면 GPS를 따로 켜지 않고 그 위치를 쓴다.
   */
  locate?: boolean;
}

/** 지도를 한 점으로 옮기라는 요청. seq가 바뀔 때마다 한 번 옮긴다. zoom(구글 기준)이 있으면 그 배율로 당긴다 */
export interface MapCenterRequest {
  coord: LatLng;
  zoom?: number;
  seq: number;
}

/**
 * 어댑터(카카오·구글·기본 지도)가 MapCanvas에게서만 받는 값. 화면은 쓰지 않는다.
 * - center: 내 위치 버튼이 보내는 이동 요청. 옮긴 뒤 '전체 보기'를 띄운다.
 * - holdFit: 따라가기 중에는 마커·선이 바뀌어도 루트 전체로 다시 맞추지 않는다.
 * - onUserMove: 사용자가 손으로 끌기·확대하거나 '전체 보기'를 눌렀다(따라가기를 푼다). 코드가 옮길 때는 부르지 않는다.
 * - locateUser: user가 내 위치 버튼에서 온 점이다. 그리기만 하고 화면 맞춤(fitCoords)에는 넣지 않는다.
 *   넣으면 빈 지도(길찾기 출발·도착 전)에서 점이 생기고 사라질 때마다 전체 맞춤이 돌아 경주 기본 화면으로 뛴다.
 */
export interface MapViewExtra {
  center?: MapCenterRequest;
  holdFit?: boolean;
  onUserMove?: () => void;
  locateUser?: boolean;
}

export type MapViewProps = MapCanvasProps & MapViewExtra;

/**
 * 카카오·구글 지도를 못 쓰게 된 이유. auth(키 거부)·script(스크립트 못 받음)는 이 세션 내내 기본 지도로,
 * tiles(타일이 시한 안에 안 옴)는 그 지도 하나만 기본 지도로 바꾼다.
 */
export type MapFailReason = 'auth' | 'script' | 'tiles';

export function mapHeight(p: Pick<MapCanvasProps, 'height' | 'compact'>): number {
  return p.height ?? (p.compact ? 140 : 320);
}

/** 확대·이동한 뒤 처음 맞춘 화면으로 돌아가는 버튼 */
export function FitAllButton({ overlayBottom, onPress }: { overlayBottom?: number; onPress: () => void }) {
  return (
    <View style={[{ position: 'absolute', left: SP.gutter, bottom: SP.xl + (overlayBottom ?? 0) }, E.float]}>
      <Btn title="전체 보기" size="sm" variant="quiet" icon="map" onPress={onPress} />
    </View>
  );
}

/** 내 위치 버튼 지름. 손가락 표적 44 */
const LOCATE_BTN = 44;

/**
 * 오른쪽 아래 둥근 '내 위치' 버튼. '전체 보기'(왼쪽 아래)와 같은 높이에 둔다(360px 폭에서도 겹치지 않는다).
 * - off: 회색 과녁 · locating: 도는 표시 · centered: 잉크 과녁 · follow: 파랑 면에 흰 과녁(지도 앱 관례, 파랑은 현재 위치에만 쓴다)
 * 읽기 이름은 누르면 무엇이 되는지다(core/map/locate.locateLabel).
 */
export function LocateButton({ mode, bottom, onPress }: { mode: LocateMode; bottom: number; onPress: () => void }) {
  const follow = mode === 'follow';
  return (
    <View style={[styles.locateWrap, { bottom: SP.xl + bottom }, E.float]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={locateLabel(mode)}
        accessibilityState={{ selected: follow, busy: mode === 'locating' }}
        onPress={onPress}
        style={[styles.locateBtn, follow ? styles.locateOn : null]}
      >
        {mode === 'locating' ? (
          <ActivityIndicator size="small" color={iconC.muted} />
        ) : (
          <Icon name="locate" size={22} color={follow ? 'onAccent' : mode === 'centered' ? 'ink' : 'muted'} stroke={mode === 'off' ? 1.7 : 2.2} />
        )}
      </Pressable>
    </View>
  );
}

/** 한 자리에 겹친 스팟 목록. 고르면 스팟 상세로 간다(마커를 누르면 스팟 상세라는 규칙) */
export function ClusterListSheet({
  memberIds,
  titleOf,
  onClose,
  onPick,
}: {
  memberIds: string[] | undefined;
  titleOf: Map<string, string>;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <Sheet visible={!!memberIds} onClose={onClose} title={memberIds ? `이 자리의 스팟 ${memberIds.length}곳` : undefined}>
      {memberIds?.map((id) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          onPress={() => {
            onClose();
            onPick(id);
          }}
          style={{ paddingVertical: SP.l, borderBottomWidth: 1, borderBottomColor: lineC.line }}
        >
          <Row gap={SP.l}>
            <Icon name="pin" size={16} color="accent" />
            <Txt v="nm" numberOfLines={1} style={{ flex: 1 }}>
              {titleOf.get(id) ?? '스팟'}
            </Txt>
            <Icon name="right" size={14} color="faint" />
          </Row>
        </Pressable>
      ))}
    </Sheet>
  );
}

/**
 * 지도 위에 띄우는 칩·버튼 자리. 빈 곳은 지도가 손가락을 받는다.
 * pointerEvents는 StyleSheet.create로만 넣는다. react-native-web은 인라인 스타일의 pointerEvents를 버려서
 * 이 판이 지도 전체를 덮고 클릭·끌기·휠과 지도 약관 링크까지 막는다(2026-10 테스트에서 확인).
 */
export function MapChildren({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <View style={styles.overlay}>{children}</View>;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, pointerEvents: 'box-none' },
  locateWrap: { position: 'absolute', right: SP.gutter, borderRadius: LOCATE_BTN / 2 },
  locateBtn: {
    width: LOCATE_BTN,
    height: LOCATE_BTN,
    borderRadius: LOCATE_BTN / 2,
    borderWidth: 1,
    borderColor: lineC.line,
    backgroundColor: surfaceC.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locateOn: { backgroundColor: mapC.user, borderColor: mapC.user },
});
