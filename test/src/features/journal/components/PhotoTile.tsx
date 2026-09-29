import React from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle, Polygon, Rect } from 'react-native-svg';

import type { Photo } from '../../../types';
import { R, SP, surfaceC, SvgLabel, Txt, type SurfaceColorKey } from '../../../ui';
import { sessionPhotoUri } from '../api';

/**
 * 사진 타일(20·21). 모의 사진은 번들 이미지 없이 sim 메타(label, tone)로 SVG를 그린다(surface 토큰, SvgLabel).
 * 웹 기기 사진은 이 세션 메모리 맵에만 있어, 새로고침 뒤나 다른 기기에서는 '이 세션에서만 보임' 타일이 된다.
 * 면과 산 모양은 같은 계열 면 토큰끼리 짝짓는다(초록 계열 선 토큰이 없어 okBg는 흰 산). 라벨은 card 띠 위의 ink라
 * TEXT_ON_SURFACE_PAIRS에 있는 조합(ink/card)만 쓴다.
 */

const TONE_BG: SurfaceColorKey[] = ['soft', 'okBg', 'warnBg', 'off'];
const TONE_FG: SurfaceColorKey[] = ['softLine', 'card', 'warnLine', 'softLine'];
const LABEL_BAND = 22;

export function PhotoTile({ photo, size, badge }: { photo: Photo; size: number; badge?: React.ReactNode }) {
  const uri = photo.uri ?? sessionPhotoUri(photo.id);
  let body: React.ReactNode;
  if (photo.sim) {
    const tone = Math.abs(photo.sim.tone) % TONE_BG.length;
    const s = size;
    body = (
      <Svg width={s} height={s}>
        <Rect x={0} y={0} width={s} height={s} rx={R.photo} fill={surfaceC[TONE_BG[tone]]} />
        <Circle cx={s * 0.72} cy={s * 0.28} r={s * 0.1} fill={surfaceC.card} />
        <Polygon
          points={`0,${s * 0.8} ${s * 0.32},${s * 0.46} ${s * 0.55},${s * 0.68} ${s * 0.72},${s * 0.54} ${s},${s * 0.82} ${s},${s} 0,${s}`}
          fill={surfaceC[TONE_FG[tone]]}
        />
        {size >= 64 ? (
          <>
            <Rect x={0} y={s - LABEL_BAND} width={s} height={LABEL_BAND} fill={surfaceC.card} />
            <SvgLabel x={8} y={s - 7} text={photo.sim.label} v="tile" c="ink" anchor="start" />
          </>
        ) : null}
      </Svg>
    );
  } else if (uri) {
    body = (
      <Image
        source={{ uri }}
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size, borderRadius: R.photo, backgroundColor: surfaceC.off }}
      />
    );
  } else {
    body = (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: R.photo,
          backgroundColor: surfaceC.off,
          padding: SP.m,
          justifyContent: 'flex-end',
        }}
      >
        <Txt v="mtTight" numberOfLines={3}>
          {photo.sessionOnly ? '이 세션에서만 보임' : '사진 파일 없음'}
        </Txt>
      </View>
    );
  }
  return (
    <View
      accessibilityLabel={photo.sim ? `예시 사진 ${photo.sim.label}` : '사진'}
      style={{ width: size, height: size, borderRadius: R.photo, overflow: 'hidden' }}
    >
      {body}
      {badge ? <View style={{ position: 'absolute', top: SP.s, left: SP.s, gap: SP.xs }}>{badge}</View> : null}
    </View>
  );
}
