import React from 'react';
import { Image, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Chip } from './Chip';
import { Icon, type IconName } from './Icon';
import { Switch } from './Switch';
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
 * 사진 위에는 왼쪽 위 badge 하나. 선택된 카드는 사진 자리에 잉크 2px 테두리이고 스크린리더에는 selected로 알린다.
 * size 'lg'는 홈 가로 줄의 내 여행(272×300, footer까지 상자 안 흰 판에 담는다), 'sm'은 추천 여행지(정사각).
 * a11yLabel: 스크린리더 이름(기본 '{title} 열기'). 실제 동작과 같게 쓴다('경주 여행 보기, 여행 중 · 2일째').
 */
export function CoverTile({
  place,
  badge,
  title,
  lines,
  selected,
  size = 'sm',
  onPress,
  pressLabel,
  corner,
  footer,
  style,
  a11yLabel,
  image,
}: {
  /** 표지 이미지 주소(data URI 등). 있으면 지역 이름 대신 사진을 꽉 채운다 */
  image?: string;
  place: string;
  badge?: string;
  title: string;
  lines: string[];
  selected?: boolean;
  size?: 'sm' | 'lg';
  onPress?: () => void;
  /** 상자를 눌렀을 때 하는 일(접근성 이름). 없으면 '제목 열기' */
  pressLabel?: string;
  /** 상자 오른쪽 위 작은 버튼(예: 수정). 상자 버튼과 겹치지 않게 형제로 둔다(웹 button 중첩 방지) */
  corner?: { label: string; a11y: string; onPress: () => void };
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  a11yLabel?: string;
}) {
  const lg = size === 'lg';
  const width = lg ? 272 : 148;
  // lg는 흰 판에 제목·날짜·개수와 footer(멤버·다음 할 일)까지 담아 정사각보다 조금 길다(272×300)
  const height = lg ? width + 28 : width;
  // lg(내 여행)는 제목·날짜·개수와 footer를 상자 안 아래 흰 판에 담는다. sm(추천)은 상자 아래에 둔다
  const inside = lg;
  const info = (
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
  );
  return (
    <View style={[{ width, gap: SP.xl }, style]}>
      <View
        style={{
          width,
          height,
          borderRadius: R.photo,
          backgroundColor: surfaceC.soft,
          borderWidth: selected ? 2 : 0,
          borderColor: lineC.ink,
          overflow: 'hidden',
        }}
      >
        {image ? (
          <Image
            source={{ uri: image }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
        ) : null}
        <View pointerEvents="none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.m }}>
          {image ? null : (
            <>
              <Icon name="pin" size={lg ? 28 : 24} color="muted" stroke={1.6} />
              <Txt v="btnSm" c="muted" numberOfLines={1}>
                {place}
              </Txt>
            </>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a11yLabel ?? pressLabel ?? `${title} 열기`}
          accessibilityState={{ selected: !!selected }}
          onPress={onPress}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {inside ? (
          // 상자 버튼(위 Pressable) 뒤 형제라 footer의 버튼이 눌린다. 판 빈 곳은 box-none이라 상자 버튼으로 통과한다
          <View
            pointerEvents="box-none"
            style={{
              marginHorizontal: SP.m,
              marginBottom: SP.m,
              paddingHorizontal: SP.l,
              paddingVertical: SP.m,
              gap: SP.l,
              borderRadius: R.card,
              borderWidth: 1,
              borderColor: lineC.line,
              backgroundColor: surfaceC.card,
            }}
          >
            <View pointerEvents="none">{info}</View>
            {footer}
          </View>
        ) : null}
        {badge ? (
          <View
            pointerEvents="none"
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
        {corner ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={corner.a11y}
            hitSlop={8}
            onPress={corner.onPress}
            style={{
              position: 'absolute',
              top: SP.xl,
              right: SP.xl,
              paddingHorizontal: SP.l,
              paddingVertical: SP.xs,
              borderRadius: R.chip,
              borderWidth: 1,
              borderColor: lineC.line,
              backgroundColor: surfaceC.card,
            }}
          >
            <Txt v="chip">{corner.label}</Txt>
          </Pressable>
        ) : null}
      </View>
      {inside ? null : info}
      {inside ? null : footer}
    </View>
  );
}

/** 머리글자 원(프로필 머리). 사진이 있으면 사진을 원 안에 채운다 */
function Monogram({ name, size, imageUri }: { name: string; size: number; imageUri?: string }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: R.chip,
        backgroundColor: surfaceC.accentTint,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          accessibilityIgnoresInvertColors
          style={{ width: size, height: size }}
        />
      ) : (
        <Txt v={size >= H.monogram ? 'monogram' : 'ttl'} c="accentDeep">
          {name.slice(0, 1) || '?'}
        </Txt>
      )}
    </View>
  );
}

/**
 * 프로필 머리 카드. brand-soft 원 안 머리글자, 이름, 그 아래 한 줄(게스트·계정). 1px line 테두리.
 * variant 'row'(프로필 탭): 왼쪽 원(56), 이름과 한 줄, 오른쪽 꺾쇠가 한 줄에 있다. 누르면 내 프로필로 간다.
 */
export function ProfileHero({
  name,
  sub,
  onPress,
  variant = 'card',
  imageUri,
}: {
  name: string;
  sub: string;
  onPress?: () => void;
  variant?: 'card' | 'row';
  imageUri?: string;
}) {
  if (variant === 'row') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name || '이름 없음'} 프로필 보기`}
        onPress={onPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SP.xxl,
          minHeight: 80,
          paddingVertical: SP.xl,
        }}
      >
        <Monogram name={name} size={H.quick} imageUri={imageUri} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt v="ttlSm" numberOfLines={1}>
            {name || '이름 없음'}
          </Txt>
          <Txt v="mt" numberOfLines={1}>
            {sub}
          </Txt>
        </View>
        {onPress ? <Icon name="right" size={18} color="muted" stroke={2} /> : null}
      </Pressable>
    );
  }
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
      <View style={{ marginBottom: SP.m }}>
        <Monogram name={name} size={H.monogram} imageUri={imageUri} />
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

/**
 * 내 프로필 맨 위(17). 가운데 큰 원(사진 또는 머리글자)과 오른쪽 아래 사진 바꾸기 버튼(camera, 44),
 * 이름, 계정 종류 칩, 그 아래 한 줄(sub). 사진 바꾸기는 원 전체를 눌러도 된다.
 */
export function ProfileEditHero({
  name,
  imageUri,
  onPhotoPress,
  chip,
  sub,
}: {
  name: string;
  imageUri?: string;
  onPhotoPress: () => void;
  chip: string;
  sub?: string;
}) {
  return (
    <View style={{ alignItems: 'center', gap: SP.m, paddingVertical: SP.xxl }}>
      <Pressable accessibilityRole="button" accessibilityLabel="프로필 사진 바꾸기" onPress={onPhotoPress}>
        <Monogram name={name} size={H.monogram} imageUri={imageUri} />
        <View
          style={{
            position: 'absolute',
            right: -SP.xs,
            bottom: -SP.xs,
            width: H.iconBtn,
            height: H.iconBtn,
            borderRadius: R.chip,
            borderWidth: 1,
            borderColor: lineC.line,
            backgroundColor: surfaceC.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="camera" size={20} color="ink" stroke={1.8} />
        </View>
      </Pressable>
      <Txt v="ttl" center>
        {name || '이름 없음'}
      </Txt>
      <View style={{ alignItems: 'center' }}>
        <Chip text={chip} tone="soft" />
      </View>
      {sub ? (
        <Txt v="mt" center>
          {sub}
        </Txt>
      ) : null}
    </View>
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
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
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
 * - onPress가 없으면 누를 수 없는 정보 줄이다(꺾쇠 없음).
 * - value: 오른쪽 현재 값 글자(muted, 예: 이메일 주소).
 * - switch: 켜고 끄는 줄. 줄 전체가 토글이고(role switch, checked) 꺾쇠 대신 Switch를 그린다. 높이 64 이상.
 */
export function ListRow({
  icon,
  label,
  sub,
  right,
  first,
  disabled,
  onPress,
  value,
  switch: toggle,
}: {
  icon?: IconName;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  first?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  value?: string;
  switch?: { value: boolean; onChange: (next: boolean) => void };
}) {
  const box: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xxl,
    minHeight: 64,
    paddingVertical: SP.xxl,
    borderTopWidth: first ? 0 : 1,
    borderTopColor: lineC.line,
  };
  const body = (
    <>
      {icon ? <Icon name={icon} size={24} color={disabled ? 'faint' : 'ink'} stroke={1.5} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="body" c={disabled ? 'muted' : 'ink'}>
          {label}
        </Txt>
        {sub ? <Txt v="mt">{sub}</Txt> : null}
      </View>
      {value ? (
        <View style={{ flexShrink: 1, maxWidth: '50%' }}>
          <Txt v="mt" numberOfLines={1}>
            {value}
          </Txt>
        </View>
      ) : null}
      {right}
    </>
  );
  if (toggle) {
    return (
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={sub ? `${label}, ${sub}` : label}
        accessibilityState={{ checked: toggle.value, disabled: !!disabled }}
        disabled={disabled}
        onPress={() => toggle.onChange(!toggle.value)}
        style={box}
      >
        {body}
        <Switch value={toggle.value} disabled={disabled} />
      </Pressable>
    );
  }
  if (!onPress) {
    return (
      <View style={box}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, sub, value].filter(Boolean).join(', ')}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={box}
    >
      {body}
      <Icon name="right" size={18} color={disabled ? 'faint' : 'muted'} stroke={2} />
    </Pressable>
  );
}
