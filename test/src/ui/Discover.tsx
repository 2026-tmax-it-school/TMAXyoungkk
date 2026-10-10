import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { H, lineC, R, SP, surfaceC } from './tokens';

/**
 * 홈·프로필 조각(Young Trip 디자인 시스템: TripCard, ListRow와 빠른 메뉴·프로필 머리).
 * 가운데 정렬이 필요한 모양이라 화면이 아니라 여기(src/ui)에 둔다. 그림자는 쓰지 않는다.
 */

/** 구역 제목(DS title 22). 오른쪽에 원형 화살표 버튼(더 보기)을 둘 수 있다 */
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
            width: 32,
            height: 32,
            borderRadius: R.chip,
            borderWidth: 1,
            borderColor: lineC.line,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="right" size={14} color="ink" stroke={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** 원형 빠른 메뉴. brand-soft 원에 brand-ink 아이콘, disabled면 회색 원. badge는 원 위 작은 배지 */
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
      style={{ flex: 1, alignItems: 'center', gap: SP.m }}
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
        <Icon name={icon} size={24} color={disabled ? 'faint' : 'accentDeep'} stroke={1.75} />
        {badge ? (
          <View
            style={{
              position: 'absolute',
              top: -4,
              right: -12,
              paddingHorizontal: SP.s,
              borderRadius: R.tag,
              borderWidth: 1,
              borderColor: lineC.line,
              backgroundColor: surfaceC.card,
            }}
          >
            <Txt v="chip" c="muted">
              {badge}
            </Txt>
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
 * 여행 카드(DS TripCard). 사진 자리가 주인공이고 카드 테두리·그림자는 없다. 사진 모서리만 radius-lg.
 * 사진이 없으면 연회색(surface-soft) 자리에 핀과 장소 이름만 둔다. 색 면이나 무늬로 사진을 흉내 내지 않는다.
 * 사진 위에는 왼쪽 위 badge 하나. 선택된 카드는 사진 자리에 잉크 2px 테두리.
 * size 'lg'는 홈 가로 줄의 내 여행(20:19), 'sm'은 추천 여행지(정사각).
 */
export function CoverTile({
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
  const width = lg ? 272 : 148;
  return (
    <View style={[{ width, gap: SP.xl }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} 열기`}
        accessibilityState={{ selected: !!selected }}
        onPress={onPress}
        style={{
          width,
          height: lg ? Math.round((width * 19) / 20) : width,
          borderRadius: R.photo,
          backgroundColor: surfaceC.soft,
          borderWidth: selected ? 2 : 0,
          borderColor: lineC.ink,
          alignItems: 'center',
          justifyContent: 'center',
          gap: SP.m,
          overflow: 'hidden',
        }}
      >
        <Icon name="pin" size={lg ? 28 : 24} color="muted" stroke={1.6} />
        <Txt v="btnSm" c="muted" numberOfLines={1}>
          {place}
        </Txt>
        {badge ? (
          <View
            style={{
              position: 'absolute',
              top: SP.xl,
              left: SP.xl,
              paddingHorizontal: SP.l,
              paddingVertical: SP.xs,
              borderRadius: R.chip,
              borderWidth: 1,
              borderColor: lineC.line,
              backgroundColor: surfaceC.card,
            }}
          >
            <Txt v="chip">{badge}</Txt>
          </View>
        ) : null}
      </Pressable>
      <View style={{ gap: 2 }}>
        <Txt v="nm" numberOfLines={1}>
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

/** 프로필 머리 카드. brand-soft 원 안 머리글자, 이름, 그 아래 한 줄(게스트·계정). 1px line 테두리 */
export function ProfileHero({ name, sub, onPress }: { name: string; sub: string; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name} 프로필 보기`}
      onPress={onPress}
      style={{
        borderRadius: R.photo,
        borderWidth: 1,
        borderColor: lineC.line,
        backgroundColor: surfaceC.card,
        paddingVertical: SP.section - 8,
        paddingHorizontal: SP.xxl,
        alignItems: 'center',
        gap: SP.xs,
      }}
    >
      <View
        style={{
          width: H.monogram,
          height: H.monogram,
          borderRadius: R.chip,
          backgroundColor: surfaceC.accentTint,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: SP.m,
        }}
      >
        <Txt v="monogram" c="accentDeep">
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

/** 프로필 아래 두 칸 타일. brand-soft 원 아이콘과 라벨, 1px line 테두리 */
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
        minHeight: 136,
        borderRadius: R.card,
        borderWidth: 1,
        borderColor: lineC.line,
        backgroundColor: surfaceC.card,
        padding: SP.xxl,
        alignItems: 'center',
        justifyContent: 'center',
        gap: SP.xl,
      }}
    >
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: SP.l,
            right: SP.l,
            paddingHorizontal: SP.s,
            borderRadius: R.tag,
            borderWidth: 1,
            borderColor: lineC.line,
          }}
        >
          <Txt v="chip" c="muted">
            {badge}
          </Txt>
        </View>
      ) : null}
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: R.chip,
          backgroundColor: disabled ? surfaceC.soft : surfaceC.accentTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={26} color={disabled ? 'faint' : 'accentDeep'} stroke={1.7} />
      </View>
      <Txt v="nm" c={disabled ? 'muted' : 'ink'} center>
        {label}
      </Txt>
    </Pressable>
  );
}

/**
 * 목록 한 줄(DS ListRow). 아이콘 24(선 1.5), 라벨 본문 16, 오른쪽 꺾쇠. 카드로 감싸지 않고 구분선으로 나눈다.
 * 구분선은 위에 둔다(first면 없음). sub는 현재 값만(설명 문장 금지).
 */
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
        gap: SP.xxl,
        minHeight: 64,
        paddingVertical: SP.xxl,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: lineC.line,
      }}
    >
      {icon ? <Icon name={icon} size={24} color={disabled ? 'faint' : 'ink'} stroke={1.5} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="body" c={disabled ? 'muted' : 'ink'}>
          {label}
        </Txt>
        {sub ? <Txt v="mt">{sub}</Txt> : null}
      </View>
      {right}
      <Icon name="right" size={18} color={disabled ? 'faint' : 'muted'} stroke={2} />
    </Pressable>
  );
}
