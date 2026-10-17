import { avatarLook, F, mapC, OPACITY, textC } from './tokens';

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
 * 공통 선택값(2026-10-12 채팅방 지도):
 * - scale: 핀 크기 배율(1~1.4로 제한, 기본 1). 돌려주는 size도 배율을 따르고, 중심(size/2)이 그대로 기준점이다.
 * - dim: 고르지 않은 지역의 핀을 흐리게(채움·테두리·글자에 OPACITY.dim).
 * 라벨은 3글자('12표')까지 핀 원 안에 들어가게 3글자 이상이면 글자를 줄인다. 2글자 이하와 배율·흐림이 없는 호출의 결과는 전과 같다.
 */

export type PinColor = 'ink' | 'slate' | 'ok' | 'warn';

/** 모든 핀 종류가 받는 선택값 */
export interface PinLook {
  scale?: number;
  dim?: boolean;
}

export type PinSpec = PinLook &
  (
    | { kind: 'spot'; label?: string; color?: PinColor; compact?: boolean; avatar?: { text: string; index: number } }
    | { kind: 'excluded'; label?: string; compact?: boolean }
    | { kind: 'base'; compact?: boolean }
    | { kind: 'cluster'; count: number; compact?: boolean }
    | { kind: 'user'; compact?: boolean }
    | { kind: 'dot'; tone: 'ink' | 'faint'; size?: 'sm' | 'md' }
  );

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

export const PIN_SCALE_MIN = 1;
export const PIN_SCALE_MAX = 1.4;

/** 배율을 1~1.4로 묶는다. 숫자가 아니면 1 */
export function pinScale(scale: number | undefined): number {
  if (scale == null || !Number.isFinite(scale)) return 1;
  return Math.min(PIN_SCALE_MAX, Math.max(PIN_SCALE_MIN, scale));
}

/** body는 기본 크기(size) 좌표로 그리고, 배율이 있으면 바깥 크기만 키운다(viewBox는 그대로) */
function wrap(size: number, body: string, look: PinLook = {}): PinSvg {
  const k = pinScale(look.scale);
  const out = k === 1 ? size : Math.ceil(size * k);
  const inner = look.dim ? `<g opacity="${OPACITY.dim}">${body}</g>` : body;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${out}" height="${out}" viewBox="0 0 ${size} ${size}"`;
  return {
    size: out,
    html: `${open} style="display:block;overflow:visible">${inner}</svg>`,
    xml: `${open}>${inner}</svg>`,
  };
}

function circle(c: number, r: number, fill: string, stroke?: string, strokeWidth?: number): string {
  const s = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth ?? 2}"` : '';
  return `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}"${s}/>`;
}

/** 3글자 이상 라벨('12표')은 원 안에 들어가게 글자를 줄인다(원 지름 30이면 11, 22이면 8.5) */
export function pinLabelSize(text: string, fontSize: number, radius: number): number {
  if ([...text].length < 3) return fontSize;
  return Math.min(fontSize, Math.floor((radius * 2 * 0.37) * 2) / 2);
}

function label(c: number, dy: number, text: string, fontSize: number, fill: string, radius?: number): string {
  const fs = radius == null ? fontSize : pinLabelSize(text, fontSize, radius);
  const y = fs === fontSize ? c + dy : Math.round((c + dy * (fs / fontSize)) * 10) / 10;
  return `<text x="${c}" y="${y}" text-anchor="middle" font-family="${F.bold}" font-size="${fs}" fill="${fill}">${esc(text)}</text>`;
}

/** 테두리가 잘리지 않게 반지름 + 테두리 + 1px 여유로 정사각형을 잡는다 */
function box(r: number, stroke: number): { size: number; c: number } {
  const size = Math.ceil((r + stroke / 2 + 1) * 2);
  return { size, c: size / 2 };
}

export function mapPinSvg(p: PinSpec): PinSvg {
  const look: PinLook = { scale: p.scale, dim: p.dim };
  switch (p.kind) {
    case 'spot': {
      const color = mapC[p.color ?? 'ink'];
      // 프로필 핀: 순번 핀과 같은 크기 원에 그 멤버 아바타 면·머리글자(ui/Avatar와 같은 색)
      if (p.avatar) {
        const r = p.compact ? 11 : 15;
        const { size, c } = box(r, 2);
        const a = avatarLook(p.avatar.index);
        return wrap(
          size,
          circle(c, r, a.bg, a.border, 2) + label(c, p.compact ? 3.5 : 4.5, [...p.avatar.text][0] ?? '', p.compact ? 9.5 : 13, textC[a.text]),
          look,
        );
      }
      if (!p.label) {
        const r = p.compact ? 6 : 7.5;
        const { size, c } = box(r, 2);
        return wrap(size, circle(c, r, color, mapC.white, 2), look);
      }
      const r = p.compact ? 11 : 15;
      const { size, c } = box(r, 2);
      return wrap(
        size,
        circle(c, r, color, mapC.white, 2) + label(c, p.compact ? 3.5 : 4.5, p.label, p.compact ? 9.5 : 13, textC.onAccent, r),
        look,
      );
    }
    case 'excluded': {
      const r = p.compact ? 11 : 14;
      const { size, c } = box(r, 2);
      return wrap(size, circle(c, r, mapC.excludedPin, mapC.faint, 2) + label(c, 3.5, p.label ?? '제외', 9.5, textC.muted, r), look);
    }
    case 'base': {
      const r = p.compact ? 9 : 12;
      const { size, c } = box(r, 3);
      return wrap(size, circle(c, r, mapC.white, mapC.ink, 3), look);
    }
    case 'cluster': {
      const r = p.compact ? 13 : 17;
      const { size, c } = box(r, 2);
      return wrap(size, circle(c, r, mapC.white, mapC.ink, 2) + label(c, 4, String(p.count), 12, textC.ink, r), look);
    }
    case 'user': {
      const r = p.compact ? 8 : 11;
      const { size, c } = box(r, 3);
      return wrap(size, circle(c, r, mapC.user, mapC.white, 3), look);
    }
    case 'dot': {
      const md = p.size === 'md';
      const r = md ? 3.5 : 2.4;
      const { size, c } = box(r, md ? 1.5 : 0);
      const fill = p.tone === 'ink' ? mapC.user : mapC.faint;
      return wrap(size, md ? circle(c, r, fill, mapC.white, 1.5) : circle(c, r, fill), look);
    }
  }
}
