/** 지역 id → 표지 그림 종류와 하늘 색 변형(순수, ui/RegionArt가 쓴다). 테스트가 .tsx 없이 볼 수 있게 따로 둔다 */
export type ArtTheme =
  | 'hanok'
  | 'fortress'
  | 'capital'
  | 'harbor'
  | 'island'
  | 'lake'
  | 'rocks'
  | 'nightSea'
  | 'coast'
  | 'oldtown'
  | 'terraces'
  | 'city';

/** 2026-10-22 보강: 도시 그림 하나로 뭉뚱그리던 지역을 지역 성격대로 나눴다(서울 궁궐·수원 화성·군산 근대 거리·남해 다랭이·단양 바위) */
const THEME_OF: Record<string, ArtTheme> = {
  gyeongju: 'hanok',
  jeonju: 'hanok',
  andong: 'hanok',
  suwon: 'fortress',
  seoul: 'capital',
  busan: 'harbor',
  incheon: 'harbor',
  pohang: 'harbor',
  tongyeong: 'harbor',
  geoje: 'harbor',
  jeju: 'island',
  gapyeong: 'lake',
  chuncheon: 'lake',
  danyang: 'rocks',
  yeosu: 'nightSea',
  gangneung: 'coast',
  sokcho: 'coast',
  gunsan: 'oldtown',
  namhae: 'terraces',
  daejeon: 'city',
  daegu: 'city',
  gwangju: 'city',
};

/** 지역 id → 그림 종류. 모르는 지역은 도시 */
export function artTheme(regionId: string | undefined): ArtTheme {
  return (regionId && THEME_OF[regionId]) || 'city';
}

/** 같은 그림을 쓰는 지역끼리도 달라 보이게 하늘 색을 셋 중 하나로 고른다(낮·노을·아침). 같은 지역은 늘 같은 값 */
export function artVariant(regionId: string | undefined): 0 | 1 | 2 {
  const s = regionId ?? '';
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 3) as 0 | 1 | 2;
}
