import type { CandidateView } from './rows';

/**
 * 후보 요약 한 줄(순수). 후보 탭 머리말 아래와 채팅 입력줄 위 후보 줄(CandidateBar)이 같이 쓴다.
 * - '후보 14곳 · 확정 11 · 제외 3'. 계획 뒤에 새로 담아 아직 배치하지 않은 곳이 있으면 ' · 계산 전 N'을 붙인다.
 * - 아직 한 번도 배치하지 않았으면 '후보 N곳 · 배치 계산 전'
 * - 후보가 없으면 undefined(줄을 숨긴다)
 * 여기 두는 이유: 같은 wave의 후보 화면과 채팅이 서로의 새 함수를 기다리지 않게 한다(rows.ts는 타입만 가져온다).
 */
export function summaryLine(v: CandidateView): string | undefined {
  if (v.total === 0) return undefined;
  const head = `후보 ${v.total}곳`;
  if (v.confirmed.length === 0 && v.excluded.length === 0) return `${head} · 배치 계산 전`;
  const pending = v.pending.length > 0 ? ` · 계산 전 ${v.pending.length}` : '';
  return `${head} · 확정 ${v.confirmed.length} · 제외 ${v.excluded.length}${pending}`;
}
