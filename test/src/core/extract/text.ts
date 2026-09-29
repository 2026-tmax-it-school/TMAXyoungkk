import type { ExtractedPhrase } from '../ports';

/**
 * 장소 표현 찾기(FR-401, WP3 소유, 순수). 규칙 기반 ExtractionProvider가 쓴다.
 *
 * 두 갈래로 찾는다.
 * 1. 어휘(장소 이름·별칭) 가장 긴 일치. 띄어쓰기는 무시하고('동궁과월지' = '동궁과 월지'),
 *    앞은 어절 시작이어야 하고, 뒤는 어절 끝이거나 조사·어미로 이어져야 한다('교촌마을을', '불국사랑').
 * 2. 어휘에 없는 이름은 장소 접미사('…해수욕장', '…박물관', '…사')로 끝나는 어절만 후보로 낸다.
 *    이 후보는 장소 제공자 검색에서 맞는 곳이 없으면 버려진다(인식 실패 시 후보도 안내도 없다).
 *
 * phrase는 언제나 원문의 부분 문자열(text.slice(start, end))이고 조사를 넣지 않는다.
 * '거기 그 카페' 같은 지시 표현은 잡지 않는다.
 */

/** 장소 이름 뒤에 붙을 수 있는 조사·어미의 앞부분. 긴 것부터 본다. */
const TAILS = [
  '에서는', '에서도', '이랑은', '까지는', '에서', '에선', '에도', '에는', '이랑', '으로', '이나', '이든', '까지',
  '부터', '보다', '처럼', '같은', '쪽으로', '근처', '주변', '앞에', '가자', '가고', '가서', '가면', '가볼', '가는',
  '갈래', '갔다', '갔던', '갔어', '갈까', '가야', '인데', '이야', '이지', '이고', '이면', '이라', '에', '로', '랑', '나', '든', '이', '가', '은', '는', '을',
  '를', '와', '과', '도', '만', '의', '야', '쪽', '앞', '엔', '은요', '요',
].sort((a, b) => b.length - a.length);

/**
 * 두 글자 이름·별칭('월지', '동궁', '오릉') 뒤에 올 때 조사로 보지 않는 한 글자.
 * '월지나', '월지만'처럼 동사 어미(지나다, -지만)와 겹쳐 일상어가 장소로 잡히는 것을 막는다.
 */
const SHORT_KEY_BAD_TAILS = new Set(['나', '야', '든', '만', '요']);

/**
 * AI 결과를 원문에 맞출 때 떼는 조사. 이름 끝 글자와 겹치기 쉬운 한 글자(도·로·만·이·가·야·의·나 등)는 떼지 않는다
 * ('울릉도', '첨성로', '영일만'). 두 글자 이상 조사·어미는 그대로 뗀다.
 */
const ANCHOR_SINGLE_TAILS = new Set(['을', '를', '은', '는', '에', '엔', '와', '과', '랑']);

/** 지시 표현. 이 말 바로 뒤의 접미사 어절은 장소 이름으로 보지 않는다. */
const DEMONSTRATIVES = new Set(['그', '저', '이', '거기', '여기', '저기', '그곳', '이곳', '저곳', '그런', '어떤', '아무', '어느', '그때', '그집', '거기서']);

/** 접미사 후보에서 뺄 말(일상어가 접미사로 끝나는 경우) */
const STOPWORDS = new Set([
  '회사', '여사', '감사', '조사', '검사', '기사', '의사', '인사', '역사', '변호사', '요리사', '일정', '결정', '걱정',
  '여행사', '간호사', '미용사', '회계사', '세무사', '약사', '목사', '판사', '교사', '강사', '대사', '행사', '봉사', '이사',
  '학교', '비교', '계산', '출산', '주차장', '정류장', '공항버스', '시장님', '마을버스', '동네카페', '근처카페',
  '아무카페', '예쁜카페', '분위기카페', '맛집식당', '동네식당', '그식당', '그카페', '우리마을',
]);

/** 어휘 밖 이름을 잡는 접미사. 한 글자 접미사는 사찰·궁·릉만 둔다(오탐 방지). */
const SUFFIXES = [
  '해수욕장', '한옥마을', '민속마을', '박물관', '미술관', '전망대', '수목원', '식물원', '해변', '폭포', '계곡',
  '공원', '시장', '서원', '향교', '고택', '왕릉', '타워', '마을', '카페', '식당', '사', '궁', '릉',
].sort((a, b) => b.length - a.length);

const HANGUL = /[가-힣]/;
const WORD_CHAR = /[가-힣A-Za-z0-9]/;
const SPACE = /\s/;

export function isSpace(ch: string | undefined): boolean {
  return ch != null && SPACE.test(ch);
}

/** 비교용 정규화. 공백을 없애고 소문자로 바꾼다. */
export function compactKey(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/** 원문에서 공백을 뺀 문자열과, 압축 위치 → 원문 위치 표 */
function compactWithMap(text: string): { compact: string; map: number[] } {
  let compact = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (SPACE.test(ch)) continue;
    compact += ch.toLowerCase();
    map.push(i);
  }
  return { compact, map };
}

/** 원문 end 위치부터 어절 끝까지(공백·문장부호 전까지) */
function restOfWord(text: string, end: number): string {
  let i = end;
  while (i < text.length && WORD_CHAR.test(text[i])) i += 1;
  return text.slice(end, i);
}

/** 이름 뒤가 어절 끝이거나 조사·어미로 이어지는지. keyLen이 2면 SHORT_KEY_BAD_TAILS 한 글자 뒤붙음은 받지 않는다. */
export function tailOk(rest: string, keyLen = 3): boolean {
  if (rest === '') return true;
  if (!HANGUL.test(rest[0])) return false;
  const t = TAILS.find((x) => rest.startsWith(x));
  if (!t) return false;
  if (keyLen <= 2 && t.length === 1 && SHORT_KEY_BAD_TAILS.has(t)) return false;
  return true;
}

/** 이름 앞이 어절 시작인지 */
function headOk(text: string, start: number): boolean {
  return start === 0 || !WORD_CHAR.test(text[start - 1]);
}

/**
 * 어절 끝의 조사를 뗀다. 떼고 나서 두 글자 이상 남을 때만 뗀다.
 * 이미 장소 접미사로 끝나면 떼지 않는다('양동마을'의 '을'은 조사가 아니다).
 */
export function stripTail(word: string): string {
  if (SUFFIXES.some((s) => word.endsWith(s))) return word;
  for (const t of TAILS) {
    if (word.length >= t.length + 2 && word.endsWith(t)) return word.slice(0, -t.length);
  }
  return word;
}

/**
 * 어휘 가장 긴 일치. surfaces는 장소 이름·별칭 목록이다(띄어쓰기 무시).
 * 겹치는 일치는 왼쪽부터, 같은 자리에서는 가장 긴 것 하나만 쓴다.
 */
export function findLexiconPhrases(text: string, surfaces: readonly string[]): ExtractedPhrase[] {
  const { compact, map } = compactWithMap(text);
  const keys = [...new Set(surfaces.map(compactKey).filter((k) => k.length >= 2))].sort((a, b) => b.length - a.length);
  const out: ExtractedPhrase[] = [];
  let i = 0;
  while (i < compact.length) {
    const startOrig = map[i];
    let matched = 0;
    if (headOk(text, startOrig)) {
      for (const k of keys) {
        if (!compact.startsWith(k, i)) continue;
        const endOrig = map[i + k.length - 1] + 1;
        if (!tailOk(restOfWord(text, endOrig), k.length)) continue;
        out.push({ phrase: text.slice(startOrig, endOrig), start: startOrig, end: endOrig });
        matched = k.length;
        break;
      }
    }
    i += matched > 0 ? matched : 1;
  }
  return out;
}

/** 어절 목록(원문 위치 포함). 문장부호는 어절을 끊는다. */
function words(text: string): { word: string; start: number }[] {
  const out: { word: string; start: number }[] = [];
  const re = /[가-힣A-Za-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ word: m[0], start: m.index });
  return out;
}

/**
 * 접미사 후보. 이미 어휘로 잡은 구간과 겹치면 내지 않는다.
 * 접미사 앞에 두 글자 이상 이름이 있어야 하고, 앞 어절이 지시 표현이면 버린다.
 */
export function findSuffixPhrases(text: string, taken: readonly ExtractedPhrase[]): ExtractedPhrase[] {
  const ws = words(text);
  const out: ExtractedPhrase[] = [];
  for (let n = 0; n < ws.length; n += 1) {
    const { word, start } = ws[n];
    const name = stripTail(word);
    const suffix = SUFFIXES.find((s) => name.endsWith(s));
    if (!suffix) continue;
    if (name.length - suffix.length < 2) continue;
    if (suffix.length === 1 && name.length < 3) continue;
    if (STOPWORDS.has(name)) continue;
    if (n > 0 && DEMONSTRATIVES.has(ws[n - 1].word)) continue;
    const end = start + name.length;
    if (taken.some((t) => t.start < end && start < t.end)) continue;
    out.push({ phrase: text.slice(start, end), start, end });
  }
  return out;
}

/** 두 갈래를 합쳐 원문 순서로 돌려준다. */
export function findPlacePhrases(text: string, surfaces: readonly string[]): ExtractedPhrase[] {
  const lex = findLexiconPhrases(text, surfaces);
  const suf = findSuffixPhrases(text, lex);
  return [...lex, ...suf].sort((a, b) => a.start - b.start);
}

/** anchorPhrases용 조사 떼기. stripTail보다 보수적이다(ANCHOR_SINGLE_TAILS). */
export function stripAnchorTail(word: string): string {
  if (SUFFIXES.some((s) => word.endsWith(s))) return word;
  for (const t of TAILS) {
    if (t.length === 1 && !ANCHOR_SINGLE_TAILS.has(t)) continue;
    if (word.length >= t.length + 2 && word.endsWith(t)) return word.slice(0, -t.length);
  }
  return word;
}

/** AI 등 외부 결과를 원문 부분 문자열로 바로잡는다. 원문에 없으면 버린다. */
export function anchorPhrases(text: string, raw: readonly Partial<ExtractedPhrase>[]): ExtractedPhrase[] {
  const out: ExtractedPhrase[] = [];
  for (const r of raw) {
    if (typeof r.phrase !== 'string' || r.phrase.trim() === '') continue;
    const phrase = r.phrase.trim();
    let start = typeof r.start === 'number' && text.slice(r.start, r.start + phrase.length) === phrase ? r.start : -1;
    if (start < 0) start = text.indexOf(phrase);
    if (start < 0) continue;
    // 조사가 붙어 왔으면 뗀다(phrase에 조사를 넣지 않는다). 이름 끝과 겹치는 한 글자는 떼지 않는다.
    const bare = stripAnchorTail(phrase);
    const end = start + bare.length;
    if (out.some((o) => o.start < end && start < o.end)) continue;
    out.push({ phrase: text.slice(start, end), start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}
