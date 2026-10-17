import type { RankRow } from '../../../core/chatmap/votes';

/**
 * 채팅방 지도 시트·목록의 글자(FR-405, 명세 밖 추가, 순수). 화면 파일(.tsx)과 테스트가 같이 쓴다.
 * '투표'라는 말은 이 폴더(src/features/chat/map) 안에만 둔다.
 */

/** 시트 머리에 보이는 사람(고른 멤버). 없으면 '전체 투표' */
export interface SheetWho {
  id: string;
  nickname: string;
  index: number;
  mine: boolean;
  count: number;
}

/** 순위 줄 투표자 한 사람: 아바타 글자(실제 닉네임)와 색 순서(멤버 등록 순), 읽는 이름(나는 '나') */
export interface Voter {
  nickname: string;
  index: number;
  label: string;
}

/**
 * 시트의 남은 표 줄(예산은 core/chatmap/votes.VOTE_BUDGET). 말한 장소의 처음 표는 예산 밖이다.
 * 예: '남은 표 2/3', 다 쓰면 '표를 다 썼어요 · 하나를 빼면 다시 줄 수 있어요'
 */
export function budgetLine(left: number, budget: number): string {
  return left > 0 ? `남은 표 ${left}/${budget}` : '표를 다 썼어요 · 하나를 빼면 다시 줄 수 있어요';
}

/** 순위 목록 아래 설명 */
export function budgetNote(budget: number): string {
  return `한 사람이 ${budget}표까지 줄 수 있고, 장소마다 한 표예요. 내가 말한 장소에는 처음부터 한 표가 들어가 있고 이 표는 ${budget}표에 들지 않아요.`;
}

/** 제외된 후보에 표를 내려 할 때의 안내 */
export const VOTE_REMOVED_REASON = '제외된 후보는 투표할 수 없어요';

/** '1위 {이름} {n}표' 또는 '아직 투표가 없어요' */
export function topLine(rank: readonly RankRow[]): string {
  const top = rank[0];
  return top && top.count > 0 ? `1위 ${top.name} ${top.count}표` : '아직 투표가 없어요';
}

/** 고른 멤버 제목의 이름 부분: '내가 말한 장소' 또는 '{이름}님이 말한 장소' */
export function whoName(who: Pick<SheetWho, 'nickname' | 'mine'>): string {
  return who.mine ? '내가 말한 장소' : `${who.nickname}님이 말한 장소`;
}

/** 고른 멤버 제목의 수 부분: '{k}곳'. 좁은 시트 머리에서는 이름이 줄어도 이 부분은 줄지 않게 따로 그린다 */
export function whoCount(who: Pick<SheetWho, 'count'>): string {
  return `${who.count}곳`;
}

/** '{이름}님이 말한 장소 {k}곳' 또는 '내가 말한 장소 {k}곳' */
export function whoTitle(who: Pick<SheetWho, 'nickname' | 'mine' | 'count'>): string {
  return `${whoName(who)} ${whoCount(who)}`;
}

/** 순위 줄 메타: '{지역} · {n}/{N}표'(지역이 없으면 '{n}/{N}표') */
export function rankMeta(row: Pick<RankRow, 'areaName' | 'count'>, total: number): string {
  return `${row.areaName ? `${row.areaName} · ` : ''}${row.count}/${total}표`;
}

/**
 * 순위 줄 스크린리더 이름. '3/4'는 날짜('3월 4일')나 분수로 읽히므로 '{N}명 중 {n}표'로 읽힌다.
 * 예: '1위 불국사, 진현동, 4명 중 3표, 지도에서 보기'
 */
export function rankA11y(row: Pick<RankRow, 'rank' | 'name' | 'areaName' | 'count'>, total: number): string {
  return `${row.rank}위 ${row.name}, ${row.areaName ? `${row.areaName}, ` : ''}${total}명 중 ${row.count}표, 지도에서 보기`;
}

/** 순위 글자 색: 1~3위는 강조(accentStrong), 나머지는 muted */
export function rankTone(rank: number): 'accentStrong' | 'muted' {
  return rank <= 3 ? 'accentStrong' : 'muted';
}
