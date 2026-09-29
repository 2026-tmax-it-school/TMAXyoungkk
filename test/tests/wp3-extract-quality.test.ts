import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Trip } from '../src/types';
import type { Region } from '../src/core/ports';
import { extractForMessage } from '../src/core/extract';
import { regionById } from '../src/data/regions';
import { createExtractionProvider } from '../src/services/extraction';
import { createPlaceProvider } from '../src/services/places';
import { fakeFetch, seqIds } from './helpers/fakes';

/**
 * 비기능 요구사항 추출 품질(WP3): 명시적 장소 언급 재현율 80% 이상, 오탐율 10% 이하.
 *
 * - 재현율 = 기대 장소 중 추출된 수 / 기대 장소 수(동명 선택으로 돌린 것도 맞은 것으로 센다)
 * - 오탐율 = 틀린 추출 수 / 전체 추출 수. 추출은 새 후보와 동명 선택 카드를 합친 것이다.
 * 문장은 시나리오 13줄과 겹치지 않게 새로 썼다. 기대값은 사람이 읽고 정한 정답이다.
 * 어휘에 없는 이름(기림사, 골굴사 등)도 일부러 넣었다. 그 문장은 재현율을 깎는 것이 맞다.
 * 코드 리뷰(04) 뒤 경계 사례를 더했다. 사전 표기와 다른 띄어쓰기·붙여 쓰기('보문 호수', '석굴암갔다가', '첨성대앞에서'),
 * 접미사로 끝나는 일상어('여행사', '간호사', '미용사'), 기점 장소 언급('라한호텔 체크인', '신경주역')이다.
 */

const region = regionById('gyeongju') as Region;

/** [문장, 기대 placeId 목록]. 동명 장소는 'ambiguous:이름'으로 적는다. */
const PLACE_SENTENCES: [string, string[]][] = [
  ['첫날은 불국사부터 가는 게 좋겠어', ['gj-bulguksa']],
  ['석굴암은 아침 일찍 가야 덜 붐빈대', ['gj-seokguram']],
  ['황리단길에서 저녁 먹고 산책하자', ['gj-hwangnidan']],
  ['국립경주박물관 무료였나?', ['gj-museum']],
  ['박물관 말고 대릉원 먼저 보자', ['gj-daereungwon']],
  ['첨성대 야경 진짜 예쁘다더라', ['gj-cheomseongdae']],
  ['월정교는 밤에 불 켜지면 가자', ['gj-woljeonggyo']],
  ['보문호 한 바퀴 자전거 타자', ['gj-bomunho']],
  ['경주월드 자유이용권 할인하던데', ['gj-gyeongjuworld']],
  ['감은사지 쪽은 차로 가야 해', ['gj-gameunsaji']],
  ['안압지 사진 찍으러 가자', ['gj-donggung']],
  ['동궁과월지 입장 마감이 몇 시야', ['gj-donggung']],
  ['천마총 안에 들어가 볼 수 있어?', ['gj-daereungwon']],
  ['교촌마을 한정식 11시 반에 예약했어', ['gj-gyochon-hanjeongsik']],
  ['교촌마을에서 한복 빌려 입자', ['gj-gyochon-village']],
  ['교리김밥 줄 길면 포장하자', ['gj-gyori-gimbap']],
  ['최부자댁도 교촌 근처래', ['gj-choi-house']],
  ['계림 숲길 걸으면 시원하겠다', ['gj-gyerim']],
  ['분황사랑 황룡사지 붙어 있더라', ['gj-bunhwangsa', 'gj-hwangnyongsa']],
  ['포석정은 생각보다 작대', ['gj-poseokjeong']],
  ['양동마을은 하루 잡아야 하나', ['gj-yangdong']],
  ['문무대왕릉에서 일출 보자', ['gj-munmu']],
  ['대왕암까지 가면 너무 멀까', ['gj-munmu']],
  ['엑스포공원 야간 개장 한대', ['gj-expo']],
  ['옥산서원 가는 길이 예쁘대', ['gj-oksan']],
  ['황남빵 선물로 사 가자', ['ambiguous:황남빵']],
  ['첨성대 카페거리 가서 커피 마시자', ['gj-cheomseongdae-cafe']],
  ['대릉원 돌담길 걷고 황리단길로 넘어가자', ['gj-daereungwon-wall', 'gj-hwangnidan']],
  ['불국사 다음에 석굴암 가면 동선 괜찮아?', ['gj-bulguksa', 'gj-seokguram']],
  ['경주박물관이랑 월지 둘 다 가능?', ['gj-museum', 'gj-donggung']],
  ['태종무열왕릉도 들르면 좋겠다', ['gj-muyeol']],
  ['오릉 근처에 주차할 데 있나', ['gj-oreung']],
  ['황성공원에서 아침 산책 어때', ['gj-hwangseong-park']],
  ['경주향교 한옥이 멋있대', ['gj-hyanggyo']],
  ['통일전 가는 길에 은행나무길 있어', ['gj-tongiljeon']],
  // 사전 표기와 다른 띄어쓰기·붙여 쓰기
  ['불국사 쪽으로 먼저 가자', ['gj-bulguksa']],
  ['석굴암갔다가 바로 내려오자', ['gj-seokguram']],
  ['보문 호수 둘레길 걷자', ['gj-bomunho']],
  ['첨성대앞에서 만나', ['gj-cheomseongdae']],
  ['황리단길가서 밥 먹자', ['gj-hwangnidan']],
  ['경주 월드 몇 시에 열어?', ['gj-gyeongjuworld']],
  // 어휘에 없는 실제 지명. 로컬 사전에 없어서 못 잡는 것이 정상이다(재현율을 깎는다).
  ['기림사까지 가기엔 시간이 부족하겠지', ['external:기림사']],
  ['골굴사 선무도 공연 보고 싶다', ['external:골굴사']],
];

/** 장소가 없는 문장. 지시 표현, 일상 대화, 장소 접미사로 끝나는 일상어를 섞었다. */
const NO_PLACE_SENTENCES: string[] = [
  '오늘 몇 시에 출발해?',
  '거기 그 카페 다시 가자',
  '그 식당 이름 뭐였더라',
  '저기 보이는 마을 예쁘다',
  '숙소 체크인은 세 시부터래',
  '회사 일 때문에 늦을 수도 있어',
  '감사합니다 다들 조심히 와',
  '역사 공부하는 느낌이라 좋다',
  '주차장 자리 있으려나',
  '기차표 예매했어?',
  '점심은 아무거나 좋아',
  '비 오면 실내로 가자',
  '사진 많이 찍자!',
  '렌터카는 내가 빌릴게',
  '근처카페 아무 데나 들어가자',
  '다들 몇 시에 일어날 거야',
  '배고프다 뭐 먹지',
  '입장료는 각자 내자',
  '일정 결정은 내일 하자',
  '여기 너무 좋다 또 오자',
  '예쁜카페 찾아볼게',
  '어느 식당이든 괜찮아',
  '짐은 숙소에 두고 나오자',
  '경주 날씨 좋대',
  // 접미사 일상어·기점 장소
  '여행사 통해서 예약했어',
  '간호사 친구가 추천했대',
  '미용사 언니가 알려줬어',
  '주말에 행사 있대',
  '라한호텔 체크인 먼저 하자',
  '신경주역에서 만나자',
];

async function run(text: string): Promise<string[]> {
  const fetch = fakeFetch(() => ({ status: 500 }));
  const r = await extractForMessage(
    { spots: [] } as unknown as Trip,
    { id: 'm', text, memberId: 'm-a' },
    {
      extraction: createExtractionProvider({ fetch }),
      places: createPlaceProvider({ fetch }),
      region,
      ids: seqIds(),
      at: 0,
    },
  );
  return [...r.created.map((s) => s.placeId), ...r.ambiguous.map((a) => `ambiguous:${a.phrase}`)];
}

test('문장 수: 장소 문장 30개 이상, 장소 없는 문장 20개 이상', () => {
  assert.ok(PLACE_SENTENCES.length >= 30);
  assert.ok(NO_PLACE_SENTENCES.length >= 20);
});

test('재현율 80% 이상, 오탐율 10% 이하', async () => {
  let expected = 0;
  let hit = 0;
  let extracted = 0;
  let wrong = 0;
  const misses: string[] = [];
  const falses: string[] = [];
  for (const [text, want] of PLACE_SENTENCES) {
    const got = await run(text);
    expected += want.length;
    for (const w of want) {
      if (got.includes(w)) hit += 1;
      else misses.push(`${text} → ${w}`);
    }
    extracted += got.length;
    for (const g of got) {
      if (!want.includes(g)) {
        wrong += 1;
        falses.push(`${text} → ${g}`);
      }
    }
  }
  for (const text of NO_PLACE_SENTENCES) {
    const got = await run(text);
    extracted += got.length;
    wrong += got.length;
    for (const g of got) falses.push(`${text} → ${g}`);
  }
  const recall = hit / expected;
  const falseRate = extracted === 0 ? 0 : wrong / extracted;
  const report = `재현율 ${(recall * 100).toFixed(1)}% (${hit}/${expected}), 오탐율 ${(falseRate * 100).toFixed(1)}% (${wrong}/${extracted})\n놓침: ${misses.join(' | ')}\n오탐: ${falses.join(' | ')}`;
  assert.ok(recall >= 0.8, report);
  assert.ok(falseRate <= 0.1, report);
  // 수치를 로그로 남긴다(추적표 갱신용)
  console.log(report);
});
