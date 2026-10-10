import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { iconC, type IconColorKey } from './tokens';

/**
 * 아이콘. 목업 ic-* 23개(24 viewBox, 선 1.7, 뒤로 1.8, 오른쪽 2.2, round)를 그대로 옮기고
 * 같은 규칙으로 더했다(2026-10-10 길찾기 swap 포함). 이모지·텍스트 화살표·반짝이·별 아이콘은 쓰지 않는다.
 */

type Shape =
  | { t: 'p'; d: string }
  | { t: 'c'; cx: number; cy: number; r: number }
  | { t: 'r'; x: number; y: number; w: number; h: number; rx: number };

const p = (d: string): Shape => ({ t: 'p', d });
const c = (cx: number, cy: number, r: number): Shape => ({ t: 'c', cx, cy, r });
const r = (x: number, y: number, w: number, h: number, rx: number): Shape => ({ t: 'r', x, y, w, h, rx });

const ICONS = {
  // 목업 23개
  home: [p('M3.5 10.2 12 3.5l8.5 6.7V20a.8.8 0 0 1-.8.8h-4.4V14h-6.6v6.8H4.3a.8.8 0 0 1-.8-.8z')],
  list: [p('M8 6h12M8 12h12M8 18h12M3.6 6h.01M3.6 12h.01M3.6 18h.01')],
  cal: [r(3.5, 5, 17, 15.5, 2), p('M3.5 10h17M8 3.2v3.6M16 3.2v3.6')],
  map: [p('M9.2 4.2 3.5 6.6v13.2l5.7-2.4 5.6 2.4 5.7-2.4V4.2l-5.7 2.4z'), p('M9.2 4.2v13.2M14.8 6.6v13.2')],
  dots: [p('M6 12h.01M12 12h.01M18 12h.01')],
  chat: [p('M20.5 12.6c0 4-3.8 7.2-8.5 7.2a9.9 9.9 0 0 1-2.7-.37L4.2 21l1.2-3.6a6.9 6.9 0 0 1-2.4-5.1c0-4 3.8-7.2 8.5-7.2s9 3.2 9 7.5z')],
  plus: [p('M12 5v14M5 12h14')],
  pin: [p('M12 21c4.2-4.6 6.3-8 6.3-10.4A6.3 6.3 0 0 0 5.7 10.6C5.7 13 7.8 16.4 12 21z'), c(12, 10.4, 2.4)],
  car: [
    p('M4 16.5v2.3a.7.7 0 0 1-.7.7H2.2v-3M20 16.5v3h-1.1a.7.7 0 0 1-.7-.7v-2.3'),
    p('M3 16.5v-4l2-5.2a1.4 1.4 0 0 1 1.3-.8h11.4a1.4 1.4 0 0 1 1.3.8l2 5.2v4z'),
    p('M6.4 13h.01M17.6 13h.01M4.6 11.5h14.8'),
  ],
  walk: [c(13.2, 4.6, 1.9), p('M11 21l1.7-5.4-2.4-2.6.8-4.3 3.4 1.5 1.1 2.6 2.6.9M10.1 9.3 7.3 11l-.9 3.2M12.7 15.6 8.9 21')],
  clock: [c(12, 12, 8.4), p('M12 7.2V12l3.2 2')],
  users: [c(9.4, 8.2, 3.4), p('M3.4 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16.2 5.2a3.4 3.4 0 0 1 0 6.3M17.6 14.9c2 .7 3.4 2.4 3.4 4.6')],
  link: [p('M10.2 13.8a3.9 3.9 0 0 0 5.6 0l2.9-3a4 4 0 0 0-5.6-5.6l-1.4 1.5'), p('M13.8 10.2a3.9 3.9 0 0 0-5.6 0l-2.9 3a4 4 0 0 0 5.6 5.6l1.4-1.5')],
  check: [p('M4.8 12.6 9.6 17.4 19.2 6.6')],
  x: [p('M6 6l12 12M18 6 6 18')],
  back: [p('M14.5 5 7.5 12l7 7')],
  right: [p('M9.5 5l7 7-7 7')],
  drag: [p('M5 9h14M5 15h14')],
  alert: [p('M12 4.2 21 19.2H3z'), p('M12 10v4M12 17h.01')],
  nav: [p('M12 3.2 20 20.8 12 16.6 4 20.8z')],
  search: [c(11, 11, 6.6), p('M15.8 15.8 20.5 20.5')],
  pinlock: [r(5.2, 10.4, 13.6, 9.4, 2), p('M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6')],
  undo: [p('M4 9.5h9.5a5.5 5.5 0 0 1 0 11H8'), p('M7.5 5.5 4 9.5 7.5 13.5')],
  // 추가 12개(같은 선 규칙)
  bus: [r(4.5, 3.5, 15, 14, 2.5), p('M4.5 10.5h15M8 14h.01M16 14h.01M7.5 17.5v2.5M16.5 17.5v2.5')],
  locate: [c(12, 12, 6.5), c(12, 12, 2), p('M12 2.8v2.7M12 18.5v2.7M2.8 12h2.7M18.5 12h2.7')],
  play: [p('M8 5.5v13l10.5-6.5z')],
  pause: [p('M8.5 5.5v13M15.5 5.5v13')],
  camera: [
    p('M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.6-2.2h5.2L16.2 7h2.3A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z'),
    c(12, 13, 3.4),
  ],
  book: [p('M4.5 5.5c2.6-1 5.2-1 7.5.8 2.3-1.8 4.9-1.8 7.5-.8v13c-2.6-1-5.2-1-7.5.8-2.3-1.8-4.9-1.8-7.5-.8z'), p('M12 6.3v13')],
  user: [c(12, 8.2, 3.6), p('M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6')],
  bell: [p('M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5z'), p('M10 20.5a2 2 0 0 0 4 0')],
  gear: [c(12, 12, 2.6), c(12, 12, 6.2), p('M12 3v2.8M12 18.2V21M3 12h2.8M18.2 12H21M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2')],
  share: [c(6, 12, 2.2), c(17.5, 6, 2.2), c(17.5, 18, 2.2), p('M8 11l7.6-4M8 13l7.6 4')],
  trash: [p('M4.5 6.5h15M9.5 6.5v-2h5v2M6.5 6.5l.9 12.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.6M10 10.5v6M14 10.5v6')],
  mail: [r(3.5, 5.5, 17, 13, 2), p('M4 7l8 6 8-6')],
  // 2026-10-10 리디자인(같은 선 규칙)
  heart: [p('M12 20.2s-7.8-4.6-7.8-10.3A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.8 2.5c0 5.7-7.8 10.3-7.8 10.3z')],
  compass: [c(12, 12, 8.6), p('M15.4 8.6 13.2 13.2 8.6 15.4 10.8 10.8z')],
  help: [c(12, 12, 8.6), p('M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.1-2.4 3.6M12 17h.01')],
  // 27 길찾기 출발·도착 바꾸기(위아래 두 화살)
  swap: [p('M8 19.5V4.5M8 4.5 4.5 8M8 4.5 11.5 8'), p('M16 4.5v15M16 19.5 12.5 16M16 19.5l3.5-3.5')],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

const DEFAULT_STROKE: Partial<Record<IconName, number>> = { back: 1.8, right: 2.2 };

export function Icon({
  name,
  size = 22,
  color = 'muted',
  stroke,
}: {
  name: IconName;
  size?: number;
  color?: IconColorKey;
  stroke?: number;
}) {
  const col = iconC[color];
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={col}
      strokeWidth={stroke ?? DEFAULT_STROKE[name] ?? 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {(ICONS[name] as Shape[]).map((s, i) => {
        if (s.t === 'p') return <Path key={i} d={s.d} />;
        if (s.t === 'c') return <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} />;
        return <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} />;
      })}
    </Svg>
  );
}
