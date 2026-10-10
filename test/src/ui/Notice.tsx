import React from 'react';
import { Pressable, View } from 'react-native';

import { Btn } from './Btn';
import { Chip } from './Chip';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';
import { lineC, R, SP, surfaceC } from './tokens';

/**
 * 안내 한 줄. line은 범위·시뮬레이터·가정 안내, warn(앰버)은 오류 문구다.
 * 주색을 오류에 쓰지 않는다.
 */
export function Notice({
  icon,
  title,
  text,
  tone = 'line',
}: {
  icon?: IconName;
  title?: string;
  text: string;
  tone?: 'line' | 'warn';
}) {
  const warn = tone === 'warn';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: SP.m,
        padding: SP.l,
        paddingHorizontal: SP.xl,
        borderRadius: R.field,
        borderWidth: 1,
        borderColor: warn ? surfaceC.warnLine : lineC.line,
        backgroundColor: warn ? surfaceC.warnBg : surfaceC.card,
      }}
    >
      {icon ? <Icon name={icon} size={16} color={warn ? 'warn' : 'muted'} stroke={1.8} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Txt v="nm" c={warn ? 'warn' : 'ink'}>
            {title}
          </Txt>
        ) : null}
        <Txt v="mt" c={warn ? 'warn' : 'muted'}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

/**
 * 앰버 경고 카드. 계획 단계의 수용량 초과(10)와 고정 초과 전용이다.
 * items는 조정안(라벨, 숫자, 누르면 적용)이다. 목업 10: 설명 문장은 앰버, 조정안 행은 warnLine 테두리의
 * 누를 수 있는 행(라운드 9)이고 라벨은 SemiBold 12.5, 값은 warn 칩이다.
 */
export function WarnCard({
  title,
  text,
  items,
}: {
  title: string;
  text?: string;
  items?: { label: string; value: string; onPress: () => void }[];
}) {
  return (
    <View
      style={{
        padding: 14,
        gap: SP.m,
        borderRadius: R.card,
        borderWidth: 1,
        borderColor: surfaceC.warnLine,
        backgroundColor: surfaceC.warnBg,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SP.m }}>
        <Icon name="alert" size={17} color="warn" stroke={1.8} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="nm" c="warn">
            {title}
          </Txt>
          {text ? (
            <Txt v="mtLoose" c="warn">
              {text}
            </Txt>
          ) : null}
        </View>
      </View>
      {items?.map((it) => (
        <Pressable
          key={it.label}
          accessibilityRole="button"
          onPress={it.onPress}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SP.m,
            paddingVertical: SP.m,
            paddingHorizontal: SP.l,
            borderRadius: R.btnSm,
            borderWidth: 1,
            borderColor: surfaceC.warnLine,
            backgroundColor: surfaceC.card,
          }}
        >
          <View style={{ flex: 1 }}>
            <Txt v="mtSemi" c="ink">
              {it.label}
            </Txt>
          </View>
          <Chip text={it.value} tone="warn" />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * 빈 상태(숙박 앱의 '메시지가 없습니다'처럼). icon이 있으면 연한 연두 원 안에 크게 그린다.
 * 가운데 정렬은 여기와 스플래시, 지도 안 글자에만 쓴다. 버튼은 주색(연두) 주 버튼 하나를 가운데 둔다.
 */
export function Empty({
  title,
  text,
  icon,
  action,
}: {
  title: string;
  text?: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={{ paddingVertical: 30, paddingHorizontal: SP.xxl, alignItems: 'center', gap: SP.m }}>
      {icon ? (
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: R.chip,
            backgroundColor: surfaceC.accentTint,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: SP.l,
          }}
        >
          <Icon name={icon} size={44} color="accentDeep" stroke={1.5} />
        </View>
      ) : null}
      <Txt v="ttlSm" center>
        {title}
      </Txt>
      {text ? (
        <Txt v="body" c="muted" center>
          {text}
        </Txt>
      ) : null}
      {action ? (
        <View style={{ marginTop: SP.l }}>
          <Btn title={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}
