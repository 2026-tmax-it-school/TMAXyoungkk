import type { Category } from '../../types';
import type { DiaryWriteBlock, DiaryWriter } from '../../core/ports';
import { josa } from '../../core/util';

/**
 * 템플릿 일기 문장(FR-702, WP6 소유, 순수). 블록마다 한 문장. 키 없이 동작하는 기본 작성기다.
 * 카테고리, 사진 수, 함께한 멤버로 문장을 고른다. 같은 입력이면 같은 문장이다.
 */

const VERB: Record<Category, string> = {
  식당: '밥을 먹었다',
  카페: '잠시 쉬어 갔다',
  관광지: '천천히 둘러봤다',
  쇼핑: '구경하며 걸었다',
  공원: '산책했다',
  기타: '들렀다',
};

function withWhom(names: string[]): string {
  if (names.length === 0) return '';
  return `${josa(names.join(', '), '과/와')} 함께 `;
}

export function templateLine(b: DiaryWriteBlock): string {
  const verb = b.category ? VERB[b.category] : '머물렀다';
  const who = withWhom(b.memberNames);
  const photo = b.photoCount > 0 ? ` 사진 ${b.photoCount}장을 남겼다.` : '';
  if (!b.category && b.photoCount > 0) return `${b.time} ${b.placeName}에서 ${who}사진 ${b.photoCount}장을 남겼다.`;
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
