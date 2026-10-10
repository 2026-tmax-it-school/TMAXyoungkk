import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Chip } from './Chip';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { E, H, lineC, R, SP, surfaceC, type SurfaceColorKey } from './tokens';

/**
 * 홈·프로필 리디자인 조각(2026-10-10). 여행 앱의 원형 빠른 메뉴,
 * 사진 대신 색 면을 쓰는 여행지 표지, 프로필 머리 카드와 목록 줄이다.
 * 그림자와 가운데 정렬이 필요한 모양이라 화면이 아니라 여기(src/ui)에 둔다.
 */

/** 여행지 표지 면. 지역 id로 하나를 고른다(같은 지역은 늘 같은 색) */
const COVERS: SurfaceColorKey[] = ['coverSea', 'coverTeal', 'coverPlum', 'coverForest', 'coverClay', 'coverNavy'];

export function coverFor(seed: string | number): SurfaceColorKey {
  if (typeof seed === 'number') return COVERS[seed % COVERS.length];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length];
}

/** 구역 제목. 오른쪽에 원형 화살표 버튼(더 보기)을 둘 수 있다 */
export function SectionTitle({ title, onMore, moreLabel }: { title: string; onMore?: () => void; moreLabel?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.l }}>
      <View style={{ flex: 1 }}>
        <Txt v="section">{title}</Txt>
      </View>
      {onMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={moreLabel ?? `${title} 더 보기`}
          onPress={onMore}
          style={{
            width: 34,
            height: 34,
            borderRadius: R.chip,
            backgroundColor: surfaceC.soft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="right" size={15} color="ink" />
        </Pressable>
      ) : null}
    </View>
  );
}

/** 원형 빠른 메뉴(여행 앱 홈의 '숙소·항공권' 줄). disabled면 회색 원, scope는 원 위 작은 배지 */
export function QuickAction({
  icon,
  label,
  sub,
  disabled,
  badge,
  onPress,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  disabled?: boolean;
  badge?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', gap: SP.s }}
    >
      <View
        style={{
          width: H.quick,
          height: H.quick,
          borderRadius: R.chip,
          backgroundColor: disabled ? surfaceC.soft : surfaceC.accentTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={26} color={disabled ? 'faint' : 'accentDeep'} stroke={1.9} />
        {badge ? (
          <View style={{ position: 'absolute', top: -4, right: -10 }}>
            <Chip text={badge} tone="line" />
          </View>
        ) : null}
      </View>
      <Txt v="quick" c={disabled ? 'muted' : 'ink'} center numberOfLines={1}>
        {label}
      </Txt>
      {sub ? (
        <Txt v="mtTight" center numberOfLines={2}>
          {sub}
        </Txt>
      ) : null}
    </Pressable>
  );
}

/**
 * 여행지 표지 타일(사진 자리). 색 면 위 핀 아이콘과 큰 지역 이름, 아래에 이름·설명 두 줄.
 * size 'lg'는 내 여행 카드, 'sm'은 추천 여행지 줄이다.
 */
export function CoverTile({
  seed,
  place,
  badge,
  title,
  lines,
  selected,
  size = 'sm',
  onPress,
  footer,
  style,
}: {
  /** 표지 색을 고르는 값. 문자열은 해시, 숫자는 순번(나란한 타일끼리 색이 겹치지 않게) */
  seed: string | number;
  place: string;
  badge?: string;
  title: string;
  lines: string[];
  selected?: boolean;
  size?: 'sm' | 'lg';
  onPress?: () => void;
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const lg = size === 'lg';
  const width = lg ? 260 : 132;
  return (
    <View style={[{ width, gap: SP.m }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} 열기`}
        accessibilityState={{ selected: !!selected }}
        onPress={onPress}
        style={{
          width,
          height: lg ? 172 : 132,
          borderRadius: R.cover,
          backgroundColor: surfaceC[coverFor(seed)],
          padding: SP.xl,
          justifyContent: 'space-between',
          overflow: 'hidden',
          borderWidth: selected ? 3 : 0,
          borderColor: lineC.accent,
          ...E.card,
        }}
      >
        {/* 사진 자리 장식: 오른쪽 아래 큰 나침반을 옅게 깐다 */}
        <View
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={{ position: 'absolute', right: lg ? -18 : -14, bottom: lg ? -22 : -16, opacity: 0.16 }}
        >
          <Icon name="compass" size={lg ? 150 : 96} color="onAccent" stroke={1.2} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          {badge ? <Chip text={badge} tone="card" /> : <View />}
          <Icon name="pin" size={lg ? 22 : 18} color="onAccent" stroke={1.8} />
        </View>
        <Txt v={lg ? 'cover' : 'nmLg'} c="onAccent" numberOfLines={1}>
          {place}
        </Txt>
      </Pressable>
      <View style={{ gap: 2 }}>
        <Txt v={lg ? 'nmLg' : 'nm'} numberOfLines={1}>
          {title}
        </Txt>
        {lines.map((l) => (
          <Txt key={l} v="mt" numberOfLines={lg ? 1 : 2}>
            {l}
          </Txt>
        ))}
      </View>
      {footer}
    </View>
  );
}

/** 프로필 머리 카드. 연보라 원 안 머리글자, 큰 이름, 그 아래 한 줄(게스트·계정) */
export function ProfileHero({ name, sub, onPress }: { name: string; sub: string; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} 프로필 보기`}
      onPress={onPress}
      style={{
        borderRadius: R.sheet,
        backgroundColor: surfaceC.card,
        paddingVertical: 28,
        paddingHorizontal: SP.xxl,
        alignItems: 'center',
        gap: SP.xs,
        ...E.card,
      }}
    >
      <View
        style={{
          width: H.monogram,
          height: H.monogram,
          borderRadius: R.chip,
          backgroundColor: surfaceC.lavender,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: SP.l,
        }}
      >
        <Txt v="monogram" c="lavenderInk">
          {name.slice(0, 1) || '?'}
        </Txt>
      </View>
      <Txt v="ttl" center>
        {name || '이름 없음'}
      </Txt>
      <Txt v="mt" center>
        {sub}
      </Txt>
    </Pressable>
  );
}

/** 프로필 아래 두 칸 타일(이전 여행·인연 자리). 큰 원형 아이콘과 굵은 라벨 */
export function FeatureTile({
  icon,
  label,
  badge,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  badge?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 150,
        borderRadius: R.card,
        backgroundColor: surfaceC.card,
        padding: SP.xxl,
        alignItems: 'center',
        justifyContent: 'center',
        gap: SP.xl,
        ...E.card,
      }}
    >
      {badge ? (
        <View style={{ position: 'absolute', top: SP.l, right: SP.l }}>
          <Chip text={badge} tone="line" />
        </View>
      ) : null}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: R.chip,
          backgroundColor: disabled ? surfaceC.soft : surfaceC.accentTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={30} color={disabled ? 'faint' : 'accentDeep'} stroke={1.7} />
      </View>
      <Txt v="nmLg" c={disabled ? 'muted' : 'ink'} center>
        {label}
      </Txt>
    </Pressable>
  );
}

/** 설정 목록 한 줄(아이콘, 라벨, 오른쪽 꺾쇠). 구분선은 위에 둔다(first면 없음) */
export function ListRow({
  icon,
  label,
  sub,
  right,
  first,
  disabled,
  onPress,
}: {
  icon?: IconName;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  first?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SP.xl + 2,
        paddingVertical: SP.xxl,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: lineC.line,
      }}
    >
      {icon ? <Icon name={icon} size={24} color={disabled ? 'faint' : 'ink'} stroke={1.5} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="nmLg" c={disabled ? 'muted' : 'ink'}>
          {label}
        </Txt>
        {sub ? <Txt v="mtTight">{sub}</Txt> : null}
      </View>
      {right}
      <Icon name="right" size={16} color={disabled ? 'faint' : 'muted'} />
    </Pressable>
  );
}
