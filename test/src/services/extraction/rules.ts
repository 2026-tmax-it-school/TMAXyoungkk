import type { ExtractedPhrase, ExtractionProvider } from '../../core/ports';
import { findPlacePhrases } from '../../core/extract/text';
import { PLACES, surfacesOf, type DictPlace } from '../../data/places';

/**
 * 규칙 기반 장소 표현 추출(WP3 소유, 순수). 키 없이 도는 기본 추출기다.
 *
 * 어휘는 로컬 장소 사전 전체의 이름·별칭이다(지역으로 거르지 않는다). 지역 밖 장소를 걸러 내는 일은
 * extractForMessage가 좌표로 한다. 그래야 '호미곶'처럼 목적지 밖 이름이 잡혀도 후보가 되지 않는 규칙을 한 곳에서 지킨다.
 * 어휘에 없는 이름은 장소 접미사로 끝나는 어절만 후보로 내고, 장소 제공자 검색에서 맞는 곳이 없으면 버려진다.
 * phrase는 원문 부분 문자열이고 조사를 넣지 않는다. 지시 표현('거기 그 카페')은 잡지 않는다.
 */
export function createRulesExtraction(opts: { places?: DictPlace[] } = {}): ExtractionProvider {
  const surfaces = (opts.places ?? PLACES).flatMap(surfacesOf);
  return {
    id: 'rules',
    async phrases(text: string): Promise<ExtractedPhrase[]> {
      return findPlacePhrases(text, surfaces);
    },
  };
}
