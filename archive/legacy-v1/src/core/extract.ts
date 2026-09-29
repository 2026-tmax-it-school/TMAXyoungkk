import type { Trip } from '../types';
import { haversineKm } from './util';
import { lookupGazetteer } from '../services/local';
import { provider, type PlaceHit } from '../services';

/**
 * FR-401 채팅 장소 추출.
 *
 * 규칙 기반이다. 메시지를 어절로 끊고 조사를 떼어 1~3어절 창을 만든 뒤,
 * 내장 사전에 먼저 맞춰 보고 없으면 장소 검색 API에 한 메시지당 최대 2번까지만 물어본다.
 * 명세서 예외 처리대로, 인식에 실패하면 후보를 만들지 않고 화면에도 아무것도 띄우지 않는다.
 */

const JOSA = [
  '이랑', '에서', '에다', '한테', '보다', '까지', '부터', '으로', '에게',
  '은', '는', '이', '가', '을', '를', '에', '로', '와', '과', '도', '만', '의', '랑',
];

/** 장소로 볼 수 없는 말. 오탐을 막는 최소한의 불용어. */
const STOPWORDS = new Set([
  '우리', '오늘', '내일', '모레', '아침', '점심', '저녁', '밤', '새벽', '오전', '오후',
  '거기', '여기', '저기', '어디', '그럼', '근데', '그리고', '다음', '이번', '첫날', '둘째',
  '셋째', '마지막', '날', '시간', '예약', '숙소', '출발', '도착', '이동', '차', '사람',
  '좋다', '좋아', '어때', '가자', '가고', '갔다', '보자', '먹자', '하자', '들르자', '올라가자',
  '진짜', '완전', '아마', '일단', '먼저', '나중', '같이', '따로', '전부', '조금', '많이',
]);

/** 동사·형용사로 끝나는 어절은 장소 이름이 아니다. */
const VERB_TAIL = /(자|고|서|다|요|죠|네|까|니|만|면|게|여|아|어|워|음|함)$/;

function stripJosa(word: string): string {
  for (const j of JOSA) {
    if (word.length > j.length + 1 && word.endsWith(j)) return word.slice(0, -j.length);
  }
  return word;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

function tokenize(text: string): string[] {
  return text
    .replace(/[.,!?~"'`()[\]{}<>:;]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** 창 하나가 장소 이름 후보로 볼 만한지 */
function looksLikePlace(phrase: string): boolean {
  if (phrase.length < 2 || phrase.length > 20) return false;
  if (STOPWORDS.has(phrase)) return false;
  if (/^[0-9]+$/.test(phrase)) return false;
  return true;
}

export interface ExtractedPlace extends PlaceHit {
  /** 메시지에서 이 장소를 가리킨 표현 */
  phrase: string;
}

/** 사전 결과 중 표현과 충분히 겹치는 것만 남긴다. */
function pickFromGazetteer(phrase: string): PlaceHit | undefined {
  const q = normalize(phrase);
  const hits = lookupGazetteer(phrase);
  return hits.find((h) => {
    const n = normalize(h.name);
    return n === q || (q.length >= 3 && (n.startsWith(q) || q.startsWith(n)));
  });
}

/** 검색 API 결과 중 표현과 이름이 겹치는 것만 남긴다. 오탐율을 낮추려는 장치다. */
function pickFromSearch(phrase: string, hits: PlaceHit[]): PlaceHit | undefined {
  const q = normalize(phrase);
  return hits.find((h) => {
    const n = normalize(h.name);
    return n.includes(q) || q.includes(n);
  });
}

export async function extractPlaces(text: string, trip: Trip): Promise<ExtractedPlace[]> {
  const words = tokenize(text).map(stripJosa);
  const found: ExtractedPlace[] = [];
  const usedNames = new Set<string>();
  let searchCalls = 0;

  // 긴 창부터 본다. "감은사지 삼층석탑"이 "감은사지"보다 먼저 잡혀야 한다.
  for (let size = 3; size >= 1; size -= 1) {
    for (let i = 0; i + size <= words.length; i += 1) {
      const parts = words.slice(i, i + size);
      const phrase = parts.join(' ').trim();
      const flat = parts.join('');

      if (!looksLikePlace(flat)) continue;
      if (parts.some((p) => STOPWORDS.has(p))) continue;
      if (size === 1 && VERB_TAIL.test(flat) && flat.length <= 3) continue;
      if (found.some((f) => normalize(f.phrase).includes(normalize(phrase)))) continue;

      let hit = pickFromGazetteer(flat) ?? pickFromGazetteer(phrase);

      if (!hit && provider.id === 'google' && searchCalls < 2 && flat.length >= 3) {
        searchCalls += 1;
        const results = await provider.searchPlaces(phrase, trip.region, trip.base.coord);
        hit = pickFromSearch(flat, results);
      }

      if (!hit) continue;
      if (usedNames.has(hit.name)) continue;

      // 목적지 밖 장소 제외 (FR-401 예외 처리). 기점에서 60km를 넘으면 버린다.
      if (haversineKm(trip.base.coord, hit.coord) > 60) continue;

      usedNames.add(hit.name);
      found.push({ ...hit, phrase });
    }
  }

  return found;
}
