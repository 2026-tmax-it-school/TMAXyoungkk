import type { Category } from '../../types';
import type { DiaryWriteBlock, DiaryWriter } from '../../core/ports';
import { DATED_PLACE_NAME, FREE_PLACE_NAME } from '../../core/journal/diary';
import { josa } from '../../core/util';

/**
 * 템플릿 일기 문장(FR-702, WP6 소유, 순수). 블록마다 한 문장. 키 없이 동작하는 기본 작성기다.
 * 카테고리, 사진 수, 그 자리에 있던 멤버로 문장을 고른다. 같은 입력이면 같은 문장이다.
 * 멤버는 문장의 주어다. 한 명이면 '민지가', 여럿이면 '민지, 준호가 함께'다. 여행방 일기는 함께 쓰는 기록이라
 * 한 명뿐일 때 '민지와 함께'로 쓰면 본인이 본인과 함께 간 문장이 된다(2026-10-09 웹 실행에서 발견).
 */

const VERB: Record<Category, string> = {
  식당: '밥을 먹었다',
  카페: '잠시 쉬어 갔다',
  관광지: '천천히 둘러봤다',
  쇼핑: '구경하며 걸었다',
  공원: '산책했다',
  기타: '들렀다',
};

function subject(names: string[]): string {
  if (names.length === 0) return '';
  const who = josa(names.join(', '), '이/가');
  return names.length === 1 ? `${who} ` : `${who} 함께 `;
}

export function templateLine(b: DiaryWriteBlock): string {
  const verb = b.category ? VERB[b.category] : '머물렀다';
  const who = subject(b.memberNames);
  const photo = b.photoCount > 0 ? ` 사진 ${b.photoCount}장을 남겼다.` : '';
  // 장소가 아닌 묶음은 '…에서'를 붙이면 어색하다('이동 중에서', '날짜만 정한 사진에서')
  if (b.placeName === FREE_PLACE_NAME) {
    return b.photoCount > 0 ? `${b.time} ${who}이동하며 사진 ${b.photoCount}장을 남겼다.` : `${b.time} ${who}이동했다.`;
  }
  if (b.placeName === DATED_PLACE_NAME) return `${b.time} ${who}사진 ${b.photoCount}장을 남겼다.`;
  if (!b.category && b.photoCount > 0) return `${b.time} ${who}${b.placeName}에서 사진 ${b.photoCount}장을 남겼다.`;
  return `${b.time} ${who}${b.placeName}에서 ${verb}.${photo}`;
}

export function createTemplateDiary(): DiaryWriter {
  return {
    id: 'template',
    async write({ blocks }) {
      return blocks.map(templateLine);
    },
  };
}
