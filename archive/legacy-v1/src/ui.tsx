import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

/** 프로토타입용 최소 스타일. 디자인은 목업 캔버스가 맡고, 여기서는 기능만 확인한다. */
export const C = {
  bg: '#FBF6F7',
  card: '#FFFFFF',
  line: '#E6DCE0',
  ink: '#1A1014',
  muted: '#6B5A61',
  rose: '#B3123F',
  tint: '#FDEFF3',
  warn: '#8A5A00',
  warnBg: '#FBF0DC',
  ok: '#2F6B4F',
  off: '#F1E6EA',
};

export const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  grow: { flex: 1 },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  h1: { fontSize: 22, fontWeight: '700', color: C.ink },
  h2: { fontSize: 16, fontWeight: '700', color: C.ink },
  body: { fontSize: 14, color: C.ink },
  muted: { fontSize: 12, color: C.muted },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    backgroundColor: C.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: C.ink,
  },
  label: { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 0.5 },
});

export function Btn({
  title,
  onPress,
  tone = 'primary',
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  tone?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg = tone === 'primary' ? C.rose : C.card;
  const fg = tone === 'primary' ? '#FFFFFF' : tone === 'danger' ? C.rose : C.muted;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        {
          backgroundColor: disabled ? C.off : bg,
          borderWidth: tone === 'primary' ? 0 : 1,
          borderColor: tone === 'danger' ? C.rose : C.line,
          borderRadius: 8,
          paddingVertical: 11,
          paddingHorizontal: 14,
          alignItems: 'center',
        },
        style,
      ]}
    >
      <Text style={{ color: disabled ? C.muted : fg, fontWeight: '700', fontSize: 14 }}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Chip({
  text,
  tone = 'tint',
}: {
  text: string;
  tone?: 'tint' | 'warn' | 'ok' | 'line';
}) {
  const map = {
    tint: { bg: C.tint, fg: '#8E0E32' },
    warn: { bg: C.warnBg, fg: C.warn },
    ok: { bg: '#E4F0E9', fg: C.ok },
    line: { bg: C.card, fg: C.muted },
  }[tone];
  return (
    <View
      style={{
        backgroundColor: map.bg,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderWidth: tone === 'line' ? 1 : 0,
        borderColor: C.line,
      }}
    >
      <Text style={{ color: map.fg, fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function Section({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={[S.row, { marginTop: 4 }]}>
      <Text style={[S.label, S.grow]}>{title}</Text>
      {right}
    </View>
  );
}

export function Tag({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: on ? C.rose : C.line,
        backgroundColor: on ? C.rose : C.card,
      }}
    >
      <Text style={{ color: on ? '#FFFFFF' : C.muted, fontWeight: '700', fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}
