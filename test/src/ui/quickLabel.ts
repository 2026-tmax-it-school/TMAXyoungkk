/** 빠른 메뉴 칸 이름(ui/Discover QuickAction): 6자를 넘고 띄어쓰기가 있으면 마지막 띄어쓰기에서 줄을 바꾼다('AI 여행지\n추천').
 * 4열 격자(칸 폭 25%)에서 글자 중간이 아니라 단어 사이에서 두 줄이 되게 한다(2026-10-17) */
export function quickLabelLines(label: string): string {
  if (label.length <= 6) return label;
  const i = label.lastIndexOf(' ');
  return i > 0 ? `${label.slice(0, i)}\n${label.slice(i + 1)}` : label;
}
