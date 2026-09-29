import React from 'react';
import { Pressable, View } from 'react-native';

import type { LatLng } from '../../types';
import type { MapDotInput, MapMarkerInput, MapPolylineInput } from '../../core/map/layout';
import { Btn, E, Icon, lineC, Row, Sheet, SP, Txt } from '../../ui';

/**
 * 지도 공통 조각(WP5 소유). 기본 지도(MapCanvas SVG)와 구글 지도가 같이 쓴다.
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
  /** 지도 위에 띄우는 칩·버튼(절대 배치) */
  children?: React.ReactNode;
  /** 지도 아래쪽을 덮는 요소(11 하단 시트) 높이. '전체 보기' 버튼을 그만큼 올린다 */
  overlayBottom?: number;
}

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

/** 지도 위에 띄우는 칩·버튼 자리. 빈 곳은 지도가 손가락을 받는다 */
export function MapChildren({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, pointerEvents: 'box-none' }}>{children}</View>;
}
