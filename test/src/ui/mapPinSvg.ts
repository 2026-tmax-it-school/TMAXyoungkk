import { F, mapC, textC } from './tokens';

/**
 * 구글 지도 위 핀 그림(SVG 문자열). 웹은 오버레이 div의 innerHTML로, 앱은 react-native-svg SvgXml로 그린다.
 * 크기·색·글자는 MapCanvas(기본 지도)와 같다. 두 지도에서 핀이 같아 보여야 한다.
 * - 순번 스팟: 잉크(또는 그날 선 색) 원에 흰 2px 테두리, 흰 순번
 * - 순번 없는 스팟: 작은 잉크 점
 * - 기점: 흰 면에 잉크 3px 링
 * - 제외: 흰 면에 옅은 테두리, muted '제외'
 * - 묶음: 흰 면에 잉크 2px 테두리, 잉크 숫자
 * - 현재 위치: 파랑 점에 흰 3px 테두리
 * - 이동 점: 파랑(ink) 또는 옅은 회색(faint)
 */

export type PinColor = 'ink' | 'slate' | 'ok' | 'warn';

export type PinSpec =
  | { kind: 'spot'; label?: string; color?: PinColor; compact?: boolean }
  | { kind: 'excluded'; label?: string; compact?: boolean }
  | { kind: 'base'; compact?: boolean }
  | { kind: 'cluster'; count: number; compact?: boolean }
  | { kind: 'user'; compact?: boolean }
  | { kind: 'dot'; tone: 'ink' | 'faint'; size?: 'sm' | 'md' };

export interface PinSvg {
  /** 웹 오버레이용(style 포함) */
  html: string;
  /** 앱 SvgXml용(style 없음) */
  xml: string;
  /** 정사각형 한 변(px). 핀 중심이 좌표에 오도록 절반만큼 당겨 놓는다 */
  size: number;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ESC[ch]);

function wrap(size: number, body: string): PinSvg {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"`;
  return {
    size,
    html: `${open} style="display:block;overflow:visible">${body}</svg>`,
    xml: `${open}>${body}</svg>`,
  };
}

function circle(c: number, r: number, fill: string, stroke?: string, strokeWidth?: number): string {
  const s = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth ?? 2}"` : '';
  return `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}"${s}/>`;
}

function label(c: number, dy: number, text: string, fontSize: number, fill: string): string {
  return `<text x="${c}" y="${c + dy}" text-anchor="middle" font-family="${F.bold}" font-size="${fontSize}" fill="${fill}">${esc(text)}</text>`;
}

/** 테두리가 잘리지 않게 반지름 + 테두리 + 1px 여유로 정사각형을 잡는다 */
function box(r: number, stroke: number): { size: number; c: number } {
  const size = Math.ceil((r + stroke / 2 + 1) * 2);
  return { size, c: size / 2 };
}

export function mapPinSvg(p: PinSpec): PinSvg {
  switch (p.kind) {
    case 'spot': {
      const color = mapC[p.color ?? 'ink'];
      if (!p.label) {
        const r = p.compact ? 6 : 7.5;
        const { size, c } = box(r, 2);
        return wrap(size, circle(c, r, color, mapC.white, 2));
      }
      const r = p.compact ? 11 : 15;
      const { size, c } = box(r, 2);
      return wrap(size, circle(c, r, color, mapC.white, 2) + label(c, p.compact ? 3.5 : 4.5, p.label, p.compact ? 9.5 : 13, textC.onAccent));
    }
    case 'excluded': {
      const r = p.compact ? 11 : 14;
      const { size, c } = box(r, 2);
      return wrap(size, circle(c, r, mapC.excludedPin, mapC.faint, 2) + label(c, 3.5, p.label ?? '제외', 9.5, textC.muted));
    }
    case 'base': {
      const r = p.compact ? 9 : 12;
      const { size, c } = box(r, 3);
      return wrap(size, circle(c, r, mapC.white, mapC.ink, 3));
    }
    case 'cluster': {
      const r = p.compact ? 13 : 17;
      const { size, c } = box(r, 2);
      return wrap(size, circle(c, r, mapC.white, mapC.ink, 2) + label(c, 4, String(p.count), 12, textC.ink));
    }
    case 'user': {
      const r = p.compact ? 8 : 11;
      const { size, c } = box(r, 3);
      return wrap(size, circle(c, r, mapC.user, mapC.white, 3));
    }
    case 'dot': {
      const md = p.size === 'md';
      const r = md ? 3.5 : 2.4;
      const { size, c } = box(r, md ? 1.5 : 0);
      const fill = p.tone === 'ink' ? mapC.user : mapC.faint;
      return wrap(size, md ? circle(c, r, fill, mapC.white, 1.5) : circle(c, r, fill));
    }
  }
}
