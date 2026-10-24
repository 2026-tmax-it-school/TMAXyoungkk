import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { artTheme, artVariant, type ArtTheme } from './regionArtTheme';

/**
 * 지역 표지 그림(2026-10-22). 여행 카드·추천 여행지에 사진이 없으면 지역 이름과 핀 아이콘만 보여 카드끼리 구분이 안 됐다.
 * 외부 사진은 저작권 때문에 쓰지 않고, 지역 성격별 평면 그림을 직접 그린다(regionArtTheme: 12종).
 * 같은 그림을 쓰는 지역도 하늘 색 변형(낮·노을·아침, artVariant)으로 달라 보인다.
 * 사용자가 표지를 올리면(trip.cover) 그 사진이 먼저다. 장식이라 스크린리더에는 숨긴다.
 */
export { artTheme, artVariant, type ArtTheme };

/** 하늘 변형: 바탕, 해, 먼 언덕 */
interface Sky {
  bg: string;
  sun: string;
  far: string;
}
const SKIES: readonly [Sky, Sky, Sky] = [
  { bg: '#E3EEF6', sun: '#F6D27A', far: '#C9DCEA' },
  { bg: '#F6E3D2', sun: '#F0A66B', far: '#E9C9B2' },
  { bg: '#EEF1E2', sun: '#F2C46D', far: '#D6E2C4' },
];

type ArtProps = { sky: Sky };

function Hanok({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="232" cy="70" r="26" fill={sky.sun} />
      <Path d="M0 170 C60 140 120 146 180 160 C240 174 270 150 300 156 L300 300 L0 300 Z" fill="#B9CF9C" />
      <Path d="M0 206 C80 186 150 196 210 206 C260 214 284 200 300 204 L300 300 L0 300 Z" fill="#7FA65A" />
      <Rect x="70" y="170" width="160" height="50" fill="#F7F1E6" />
      <Path d="M46 172 Q150 136 254 172 L244 182 Q150 152 56 182 Z" fill="#2F3B46" />
      <Rect x="86" y="184" width="12" height="36" fill="#8A5A3C" />
      <Rect x="202" y="184" width="12" height="36" fill="#8A5A3C" />
      <Rect x="128" y="192" width="44" height="28" fill="#D9C7A6" />
      <Rect y="220" width="300" height="80" fill="#6E8F4E" />
    </>
  );
}

/** 수원 화성: 성곽과 문루 */
function Fortress({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="60" cy="66" r="22" fill={sky.sun} />
      <Path d="M0 180 C70 160 140 170 210 158 C250 152 280 160 300 158 L300 300 L0 300 Z" fill={sky.far} />
      <Path d="M0 214 L300 196 L300 236 L0 252 Z" fill="#C9B79A" />
      <Path d="M0 214 L300 196" stroke="#A8957A" strokeWidth={4} />
      <Path d="M10 208 h12 M40 206 h12 M70 204 h12 M190 198 h12 M220 196 h12 M250 194 h12 M280 192 h12" stroke="#A8957A" strokeWidth={8} />
      <Rect x="112" y="150" width="76" height="56" fill="#C9B79A" />
      <Path d="M138 206 V182 a12 12 0 0 1 24 0 V206 Z" fill="#5B4A3A" />
      <Path d="M100 154 Q150 124 200 154 L192 160 Q150 136 108 160 Z" fill="#2F3B46" />
      <Rect x="122" y="128" width="56" height="20" fill="#B5473A" />
      <Path d="M114 132 Q150 108 186 132 L180 136 Q150 118 120 136 Z" fill="#2F3B46" />
      <Path d="M0 252 L300 236 L300 300 L0 300 Z" fill="#7FA65A" />
    </>
  );
}

/** 서울: 궁궐 지붕과 남산 타워 */
function Capital({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="244" cy="62" r="20" fill={sky.sun} />
      <Path d="M150 170 C180 120 230 110 300 140 L300 300 L120 300 Z" fill="#8FB07A" />
      <Rect x="226" y="62" width="6" height="74" fill="#6E7F8F" />
      <Rect x="218" y="86" width="22" height="12" rx="4" fill="#6E7F8F" />
      <Rect x="20" y="150" width="30" height="80" fill={sky.far} />
      <Rect x="54" y="126" width="26" height="104" fill="#B8C6D6" />
      <Rect x="84" y="160" width="28" height="70" fill={sky.far} />
      <Path d="M0 236 H300 V300 H0 Z" fill="#7FA65A" />
      <Rect x="60" y="196" width="180" height="40" fill="#F7F1E6" />
      <Rect x="76" y="206" width="10" height="30" fill="#B5473A" />
      <Rect x="214" y="206" width="10" height="30" fill="#B5473A" />
      <Path d="M36 200 Q150 160 264 200 L252 210 Q150 178 48 210 Z" fill="#2F3B46" />
      <Path d="M96 176 Q150 156 204 176 L196 182 Q150 168 104 182 Z" fill="#2F3B46" />
      <Rect x="112" y="180" width="76" height="14" fill="#3E7D63" />
    </>
  );
}

function Harbor({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="228" cy="70" r="22" fill={sky.sun} />
      <Rect x="14" y="120" width="26" height="70" fill="#A9BED0" />
      <Rect x="44" y="96" width="22" height="94" fill="#93AABF" />
      <Rect x="70" y="132" width="28" height="58" fill="#A9BED0" />
      <Rect y="186" width="300" height="114" fill="#4C86B8" />
      <Path d="M0 214 H300 M0 242 H300" stroke="#6FA0CA" strokeWidth={4} />
      <Path d="M110 182 Q190 130 270 182" stroke="#FFFFFF" strokeWidth={4} fill="none" />
      <Rect x="128" y="132" width="6" height="56" fill="#FFFFFF" />
      <Rect x="246" y="132" width="6" height="56" fill="#FFFFFF" />
      <Path d="M90 186 H300" stroke="#FFFFFF" strokeWidth={6} />
      <Path d="M40 250 L70 250 L64 262 L46 262 Z" fill="#F7F1E6" />
      <Path d="M56 250 V232 L70 246 Z" fill="#FFFFFF" />
    </>
  );
}

function Island({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="70" cy="70" r="20" fill={sky.sun} />
      <Rect y="176" width="300" height="70" fill="#5FA3B8" />
      <Path d="M60 186 L100 110 Q150 92 200 110 L240 186 Z" fill="#6E9455" />
      <Path d="M100 110 Q150 126 200 110" stroke="#5A7E44" strokeWidth={6} fill="none" />
      <Rect y="238" width="300" height="62" fill="#F2D45C" />
      <Path d="M0 238 C50 230 100 246 150 238 C200 230 250 246 300 238" stroke="#E9C33D" strokeWidth={6} fill="none" />
      <Path d="M20 268 l6 -10 6 10 M60 280 l6 -10 6 10 M250 272 l6 -10 6 10" stroke="#6E9455" strokeWidth={3} fill="none" />
    </>
  );
}

function Lake({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="236" cy="62" r="18" fill={sky.sun} />
      <Path d="M0 170 L70 90 L120 140 L180 70 L250 150 L300 110 L300 300 L0 300 Z" fill="#7FA65A" />
      <Path d="M0 200 L90 140 L160 190 L230 150 L300 190 L300 300 L0 300 Z" fill="#5F8F3E" />
      <Path d="M0 220 C70 206 140 232 210 218 C250 210 280 214 300 220 L300 300 L0 300 Z" fill="#8FC0D8" />
      <Path d="M40 250 H140 M170 266 H260" stroke="#BFDDEA" strokeWidth={4} strokeLinecap="round" />
      <Path d="M120 244 l20 0 l-4 8 l-12 0 Z" fill="#B5473A" />
    </>
  );
}

/** 단양: 강 가운데 세 바위(도담삼봉) */
function Rocks({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="64" cy="64" r="20" fill={sky.sun} />
      <Path d="M0 150 C50 120 100 130 150 140 C200 150 250 120 300 130 L300 300 L0 300 Z" fill={sky.far} />
      <Path d="M0 176 C60 160 120 170 180 166 C230 162 270 170 300 168 L300 300 L0 300 Z" fill="#7FA65A" />
      <Rect y="196" width="300" height="104" fill="#6FA7C7" />
      <Path d="M120 214 C122 170 134 150 150 150 C166 150 178 170 180 214 Z" fill="#6F7A70" />
      <Path d="M84 216 C86 192 94 182 104 182 C114 182 120 194 122 216 Z" fill="#7E897E" />
      <Path d="M178 216 C180 196 188 188 196 188 C204 188 210 198 212 216 Z" fill="#7E897E" />
      <Path d="M140 152 Q150 138 160 152" fill="#5F8F3E" />
      <Path d="M20 240 H110 M170 256 H280" stroke="#A3CCE0" strokeWidth={4} strokeLinecap="round" />
    </>
  );
}

function NightSea() {
  return (
    <>
      <Rect width="300" height="300" fill="#283654" />
      <Circle cx="232" cy="64" r="20" fill="#F5E6B8" />
      <Rect y="180" width="300" height="120" fill="#1F2B45" />
      <Path d="M50 178 Q150 100 250 178" stroke="#9FB6E0" strokeWidth={4} fill="none" />
      <Path d="M20 180 H300" stroke="#C9D6EE" strokeWidth={5} />
      <Path d="M70 210 h80 M180 210 h90 M110 236 h70 M200 254 h50" stroke="#F5C66B" strokeWidth={4} strokeLinecap="round" />
      <Circle cx="80" cy="60" r="2" fill="#F5E6B8" />
      <Circle cx="140" cy="40" r="2" fill="#F5E6B8" />
      <Circle cx="180" cy="90" r="2" fill="#F5E6B8" />
    </>
  );
}

function Coast({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="222" cy="76" r="24" fill={sky.sun} />
      <Rect y="160" width="300" height="80" fill="#5E9BC8" />
      <Path d="M0 182 C40 176 80 188 120 182 C160 176 200 188 240 182 C270 178 290 182 300 182" stroke="#8DBFE0" strokeWidth={4} fill="none" />
      <Path d="M0 236 C60 226 120 244 180 234 C230 226 270 236 300 232 L300 300 L0 300 Z" fill="#E8D8B6" />
      <Rect x="40" y="198" width="56" height="44" rx="6" fill="#8A5A3C" />
      <Path d="M96 210 h10 a10 10 0 0 1 0 20 h-10" stroke="#8A5A3C" strokeWidth={6} fill="none" />
      <Path d="M56 188 c0-8 8-8 8-16 M74 188 c0-8 8-8 8-16" stroke="#B49A7A" strokeWidth={4} strokeLinecap="round" fill="none" />
    </>
  );
}

/** 군산: 근대 거리(붉은 벽돌 건물과 가로등) */
function Oldtown({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="240" cy="60" r="18" fill={sky.sun} />
      <Rect x="20" y="130" width="110" height="110" fill="#B5604A" />
      <Path d="M14 132 H136 L126 116 H24 Z" fill="#7D3D2E" />
      <Rect x="36" y="150" width="18" height="26" fill="#F3E3C8" />
      <Rect x="66" y="150" width="18" height="26" fill="#F3E3C8" />
      <Rect x="96" y="150" width="18" height="26" fill="#F3E3C8" />
      <Rect x="62" y="200" width="26" height="40" fill="#5B3A2E" />
      <Rect x="150" y="150" width="120" height="90" fill="#E7DCC6" />
      <Path d="M144 152 H276 L266 136 H154 Z" fill="#6E7F8F" />
      <Rect x="166" y="170" width="22" height="30" fill="#8FB3C9" />
      <Rect x="200" y="170" width="22" height="30" fill="#8FB3C9" />
      <Rect x="234" y="170" width="22" height="30" fill="#8FB3C9" />
      <Rect y="240" width="300" height="60" fill="#B9AE9A" />
      <Path d="M0 262 H300" stroke="#A39882" strokeWidth={3} />
      <Rect x="138" y="170" width="4" height="70" fill="#3E4A55" />
      <Circle cx="140" cy="166" r="7" fill="#F5C66B" />
    </>
  );
}

/** 남해: 바다로 내려가는 다랭이 논 */
function Terraces({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="70" cy="62" r="20" fill={sky.sun} />
      <Rect y="120" width="300" height="80" fill="#5E9BC8" />
      <Path d="M300 120 C230 130 190 160 170 200 L300 200 Z" fill={sky.far} />
      <Path d="M0 160 C80 150 150 170 300 150 L300 300 L0 300 Z" fill="#8DB86A" />
      <Path d="M0 190 C90 178 170 200 300 182" stroke="#6E9A4E" strokeWidth={5} fill="none" />
      <Path d="M0 220 C90 208 170 230 300 212" stroke="#6E9A4E" strokeWidth={5} fill="none" />
      <Path d="M0 250 C90 238 170 260 300 242" stroke="#6E9A4E" strokeWidth={5} fill="none" />
      <Path d="M0 280 C90 268 170 290 300 272" stroke="#6E9A4E" strokeWidth={5} fill="none" />
      <Rect x="220" y="196" width="30" height="20" fill="#F7F1E6" />
      <Path d="M214 198 L235 184 L256 198 Z" fill="#D46A4C" />
    </>
  );
}

/** 도시(대전·대구·광주): 강과 다리, 불 켜진 창이 있는 스카이라인. 2026-10-22: 회색 상자 몇 개라 밋밋했다 */
function City({ sky }: ArtProps) {
  return (
    <>
      <Rect width="300" height="300" fill={sky.bg} />
      <Circle cx="236" cy="70" r="24" fill={sky.sun} />
      <Path d="M0 160 C60 140 120 150 180 136 C230 126 270 140 300 134 L300 300 L0 300 Z" fill={sky.far} />
      <Rect x="18" y="118" width="40" height="104" rx="3" fill="#8AA1B8" />
      <Rect x="64" y="84" width="34" height="138" rx="3" fill="#6E87A1" />
      <Rect x="104" y="132" width="44" height="90" rx="3" fill="#9CB0C4" />
      <Rect x="154" y="98" width="30" height="124" rx="3" fill="#6E87A1" />
      <Path d="M169 98 V74" stroke="#6E87A1" strokeWidth={4} />
      <Rect x="190" y="140" width="52" height="82" rx="3" fill="#8AA1B8" />
      <Rect x="248" y="116" width="36" height="106" rx="3" fill="#6E87A1" />
      <Path
        d="M28 134 h8 M42 134 h8 M28 152 h8 M42 152 h8 M74 102 h6 M86 102 h6 M74 122 h6 M86 122 h6 M74 142 h6 M114 150 h8 M130 150 h8 M164 116 h6 M164 136 h6 M200 158 h8 M220 158 h8 M258 134 h6 M270 134 h6 M258 154 h6"
        stroke="#F5DCA0"
        strokeWidth={6}
      />
      <Rect y="222" width="300" height="34" fill="#7FB0D0" />
      <Path d="M0 236 H300" stroke="#A5C9E0" strokeWidth={3} />
      <Path d="M0 222 Q75 196 150 222 Q225 196 300 222" stroke="#F7F1E6" strokeWidth={4} fill="none" />
      <Rect y="256" width="300" height="44" fill="#7FA65A" />
      <Circle cx="40" cy="256" r="12" fill="#5F8F3E" />
      <Circle cx="260" cy="258" r="14" fill="#5F8F3E" />
    </>
  );
}

const ART: Record<ArtTheme, (p: ArtProps) => React.JSX.Element> = {
  hanok: Hanok,
  fortress: Fortress,
  capital: Capital,
  harbor: Harbor,
  island: Island,
  lake: Lake,
  rocks: Rocks,
  nightSea: NightSea,
  coast: Coast,
  oldtown: Oldtown,
  terraces: Terraces,
  city: City,
};

/** 상자를 꽉 채운다(가운데 기준으로 잘림). 부모가 크기와 모서리를 정한다 */
export function RegionArt({ regionId }: { regionId: string | undefined }) {
  const Art = ART[artTheme(regionId)];
  return (
    <Svg width="100%" height="100%" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <Art sky={SKIES[artVariant(regionId)]} />
    </Svg>
  );
}
