import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

/**
 * WP6 여행 기록(20 사진 · 21 일기 · 22 기록 지도) 공통 탭과 화면 정리.
 * 세 화면은 머리말 아래 RecordTabs(사진 | 일기 | 지도)로 서로 바꿔 끼우고(replace) 보던 날짜를 넘긴다.
 * 화면 소스 규칙 테스트다(주석은 빼고 본다).
 */

const read = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const PHOTOS = 'src/screens/PhotosScreen.tsx';
const DIARY = 'src/screens/DiaryScreen.tsx';
const RECORD_MAP = 'src/screens/RecordMapScreen.tsx';
const SCREENS = [PHOTOS, DIARY, RECORD_MAP];

/** Foot 블록 하나의 소스 */
function footOf(src: string): string {
  const m = /<Foot>([\s\S]*?)<\/Foot>/.exec(src);
  assert.ok(m, 'Foot이 있다');
  return m[1];
}

describe('공통 탭 RecordTabs', () => {
  test('탭은 사진 camera · 일기 book · 지도 map이고, 바꾸면 replace로 보던 날짜를 넘긴다', () => {
    const src = read('src/features/journal/components/RecordTabs.tsx');
    assert.match(src, /key: 'Photos', label: '사진', icon: 'camera'/);
    assert.match(src, /key: 'Diary', label: '일기', icon: 'book'/);
    assert.match(src, /key: 'RecordMap', label: '지도', icon: 'map'/);
    assert.match(src, /if \(k !== current\) navigation\.replace\(k, \{ tripId, date \}\)/);
    assert.doesNotMatch(src, /navigation\.navigate\(/, '탭은 화면을 쌓지 않는다');
  });

  test('세 화면이 머리말 아래, 날짜 탭 위에 RecordTabs를 두고 date를 넘긴다', () => {
    const want: Record<string, RegExp> = {
      [PHOTOS]: /<RecordTabs current="Photos" tripId=\{tripId\} date=\{date === 'all' \? undefined : date\} \/>/,
      [DIARY]: /<RecordTabs current="Diary" tripId=\{tripId\} date=\{date\} \/>/,
      [RECORD_MAP]: /<RecordTabs current="RecordMap" tripId=\{tripId\} date=\{date\} \/>/,
    };
    for (const f of SCREENS) {
      const src = read(f);
      assert.match(src, want[f], f);
      const header = src.lastIndexOf('<Header');
      const tabs = src.indexOf('<RecordTabs');
      const dates = src.indexOf('<DateSeg');
      assert.ok(header >= 0 && header < tabs && tabs < dates, `${f}: 머리말 → RecordTabs → DateSeg 순서`);
    }
  });

  test('routes: 세 화면 모두 date를 받는다(사진도 date?)', () => {
    const routes = read('src/navigation/routes.ts');
    assert.match(routes, /Photos: \{ tripId: string; date\?: string \}/);
    assert.match(routes, /Diary: \{ tripId: string; date\?: string \}/);
    assert.match(routes, /RecordMap: \{ tripId: string; date\?: string \}/);
  });

  test('옛 교차 이동 버튼 줄이 없다', () => {
    for (const f of SCREENS) {
      const src = read(f);
      assert.doesNotMatch(src, /title="기록 지도" icon="map"/, f);
      assert.doesNotMatch(src, /title="일기" icon="book"/, f);
      assert.doesNotMatch(src, /title="사진" icon="camera"/, f);
      assert.doesNotMatch(src, /navigation\.navigate\('(Photos|Diary|RecordMap)'/, `${f}: 기록 화면끼리는 navigate로 쌓지 않는다`);
    }
  });

  test('머리말: eyebrow는 여행 제목, title은 여행 기록. 뒤로는 useBack(Home), 없는 여행방은 NotFound', () => {
    for (const f of SCREENS) {
      const src = read(f);
      assert.match(src, /eyebrow=\{trip\.title\}\s+title="여행 기록"/, f);
      assert.match(src, /const back = useBack\('Home'\)/, f);
      assert.match(src, /<NotFound title="여행방을 찾을 수 없어요" onHome=\{\(\) => navigation\.navigate\('Main', \{ screen: 'Home' \}\)\} \/>/, f);
      assert.doesNotMatch(src, /canGoBack\(\)/, f);
    }
  });
});

describe('날짜 탭 DateSeg', () => {
  test('바깥 ScrollView 없이 Seg가 스스로 밀고, 라벨은 daySegLabel, 칸마다 스크린리더 이름을 단다', () => {
    const src = read('src/features/journal/components/DateSeg.tsx');
    assert.doesNotMatch(src, /ScrollView/);
    assert.match(src, /import \{ daySegLabel \} from '\.\.\/\.\.\/schedule\/view'/);
    assert.match(src, /label: daySegLabel\(d\)/);
    assert.match(src, /a11yLabel: dateA11yLabel\(d,/);
    assert.match(src, /`\$\{m\}월 \$\{d\}일 \$\{WEEKDAY_FULL\[weekday\(date\)\]\}`/);
    assert.match(src, /`\$\{day\}, 사진 \$\{photos\}장`/);
  });

  test('개수는 사진 화면에서만 보인다', () => {
    assert.match(read(PHOTOS), /<DateSeg trip=\{trip\} value=\{date\} onChange=\{setDate\} all photoCounts=\{counts\} showCount \/>/);
    for (const f of [DIARY, RECORD_MAP]) assert.doesNotMatch(read(f), /<DateSeg[^>]*showCount/, f);
  });
});

describe('20 사진', () => {
  test('처음 날짜는 넘겨받은 date, 없으면 전체', () => {
    assert.match(read(PHOTOS), /useState\(route\.params\.date \?\? 'all'\)/);
  });

  test("Foot은 '사진 올리기' 하나(올리는 중), 예시 사진은 dots 시트와 빈 화면 아래 quiet", () => {
    const src = read(PHOTOS);
    const foot = footOf(src);
    assert.match(foot, /title=\{busy \? '올리는 중' : '사진 올리기'\}/);
    assert.equal((foot.match(/<Btn\b/g) ?? []).length, 1, 'Foot 버튼은 하나');
    assert.doesNotMatch(foot, /예시 사진/);
    assert.match(src, /<IconBtn icon="dots" label="사진 메뉴"/);
    assert.match(src, /<ListRow[\s\S]{0,80}label="예시 사진 3장 넣기"/);
    assert.match(src, /<Empty[\s\S]{0,400}<Btn title="예시 사진 3장 넣기" variant="quiet"/);
  });

  test('나간 멤버 안내, 골랐는데 0장이면 성공 토스트 없음', () => {
    const src = read(PHOTOS);
    assert.match(src, /나간 멤버는 사진을 볼 수만 있어요/);
    assert.match(src, /if \(r\.picked === 0 \|\| r\.photos\.length === 0\) return;[\s\S]{0,900}toast\(parts\.join/);
  });

  test("전체는 날짜별 묶음(머리와 '이 날 일기'), 기간 밖 사진은 맨 아래 '여행 기간 밖' 묶음", () => {
    const src = read(PHOTOS);
    assert.match(src, /for \(const d of days\)[\s\S]{0,200}groups\.push\(\{ key: d, title: daySegLabel\(d\), date: d, photos: ps \}\)/);
    assert.match(src, /groups\.push\(\{ key: 'outside', title: '여행 기간 밖', photos: outside \}\)/);
    assert.match(src, /<TextLink title="이 날 일기"/);
    assert.match(src, /navigation\.replace\('Diary', \{ tripId, date: d \}\)/);
  });

  test('타일 배지는 하나(날짜 지정 > 추정 > 장소 추정), 라벨 띠는 96 이상이고 배지가 없을 때만', () => {
    const tile = read('src/features/journal/components/PhotoTile.tsx');
    assert.match(
      tile,
      /if \(isDateAssigned\(p\)\) return '날짜 지정';\s+if \(p\.source === 'estimated'\) return '추정';\s+if \(isPlaceEstimated\(p\)\) return '장소 추정';/,
    );
    assert.match(tile, /badge\?: string/);
    assert.match(tile, /size >= LABEL_MIN && !badge/);
    assert.match(tile, /const LABEL_MIN = 96;/);
    const src = read(PHOTOS);
    assert.match(src, /accessibilityLabel=\{`\$\{spotName\(p\.spotId\) \?\? '장소 모름'\} \$\{kstHHMM\(p\.takenAt\)\} 사진\$\{badge \? `, \$\{badge\}` : ''\}`\}/);
    assert.doesNotMatch(src, /<Chip text="압축"/, '압축은 타일 배지가 아니다');
  });

  test("정보 시트: 찍은 때 · 장소 · 올린 사람 세 줄, 압축 줄은 압축일 때만, 남의 사진은 '올린 사람만 지울 수 있어요'", () => {
    const src = read(PHOTOS);
    for (const l of ['찍은 때', '장소', '올린 사람']) assert.match(src, new RegExp(`<InfoLine\\s+label="${l}"`));
    assert.match(src, /\{selected\.compressed \? \(/);
    assert.match(src, /올린 사람만 지울 수 있어요/);
    assert.match(src, /title="이 날 일기 보기"/);
  });
});

describe('21 일기', () => {
  test('일기가 없는 날: 기록이 있으면 일기 만들기, 없으면 사진 올리기(만들기 버튼 없음)', () => {
    const src = read(DIARY);
    assert.match(
      src,
      /pending\.length > 0 \? \(\s*canWrite \? \(\s*<Empty[\s\S]{0,120}title=\{`\$\{daySegLabel\(date\)\} 일기를 만들 수 있어요`\}[\s\S]{0,200}action=\{\{ label: '일기 만들기', onPress: \(\) => void make\(\) \}\}/,
    );
    const none = /title="이 날은 기록이 없어요"[\s\S]*?\/>/.exec(src);
    assert.ok(none, '기록 없는 날 빈 화면');
    assert.match(none[0], /label: '사진 올리기'/);
    assert.doesNotMatch(none[0], /make|generateDiary|일기 만들기/, '기록이 없는 날에는 만들기 버튼이 없다');
    assert.equal((src.match(/'일기 만들기'/g) ?? []).length, 1, "'일기 만들기'는 기록이 있는 날 빈 화면에만");
  });

  test('나간 멤버의 빈 날은 만들 수 있다거나 올리라고 안내하지 않는다', () => {
    const src = read(DIARY);
    // 기록이 있는 날: 쓸 수 없으면 '아직 없어요'만, 버튼 없음
    const ro = /: \(\s*<Empty\s+icon="book"\s+title=\{`\$\{daySegLabel\(date\)\} 일기가 아직 없어요`\}[\s\S]*?\/>/.exec(src);
    assert.ok(ro, '쓸 수 없는 멤버의 기록 있는 날 빈 화면');
    assert.doesNotMatch(ro[0], /action=|만들 수 있어요/);
    // 기록이 없는 날: 안내 문장과 '사진 올리기'는 쓸 수 있을 때만
    const none = /title="이 날은 기록이 없어요"[\s\S]*?\/>/.exec(src);
    assert.ok(none);
    assert.match(none[0], /text=\{canWrite \? '사진을 올리거나 장소에 도착하면 일기를 만들 수 있어요' : undefined\}/);
    assert.match(none[0], /action=\{canWrite \? \{ label: '사진 올리기'/);
  });

  test('만드는 중 안내(clock), 나간 멤버는 만들기와 고치기가 없다', () => {
    const src = read(DIARY);
    assert.match(src, /\{busy \? <Notice icon="clock" title="일기 만드는 중"/);
    assert.match(src, /const canWrite = !!me && !left;/);
    assert.match(src, /onPress=\{\s*canWrite\s*\?/);
  });

  test("Foot은 '공유하기' 하나, 시트에서 메시지·메모와 커뮤니티를 고른다. 다시 만들기는 안내 action과 dots 시트", () => {
    const src = read(DIARY);
    const foot = footOf(src);
    assert.equal((foot.match(/<Btn\b/g) ?? []).length, 1);
    assert.match(foot, /<Btn title="공유하기" icon="share" onPress=\{\(\) => setShareOpen\(true\)\} \/>/);
    assert.doesNotMatch(foot, /다시 만들기|일기 만들기|커뮤니티/);
    assert.match(src, /label="메시지·메모로 보내기"/);
    assert.match(src, /entry && entry\.blocks\.length > 0 \? \(\s*<ListRow[\s\S]{0,80}label="커뮤니티에 올리기"/);
    assert.match(src, /navigation\.navigate\('CommunityCompose', \{ tripId, date \}\)/);
    assert.match(src, /action=\{\{ label: '다시 만들기', onPress: \(\) => void make\(\) \}\}/);
    assert.match(src, /<IconBtn icon="dots" label="일기 메뉴"/);
    assert.match(src, /<ListRow[\s\S]{0,80}label="다시 만들기"/);
  });

  test("머리 보조 줄은 '방문 N곳 · 사진 N장'(공유함), 칩 줄과 쌓인 안내가 없다", () => {
    const src = read(DIARY);
    assert.match(src, /`방문 \$\{visits\}곳 · 사진 \$\{photoCount\}장\$\{entry\?\.sharedAt != null \? ' · 공유함' : ''\}`/);
    assert.doesNotMatch(src, /<Chip text=\{`방문/);
    assert.doesNotMatch(src, /<Chip text="AI가 쓴 문장"/);
    assert.match(src, /b\.text && b\.editedAt == null/, 'AI 문장 안내는 고치지 않은 문장이 있을 때만');
    // 새 기록과 비운 문단은 한 안내로 합친다
    assert.match(src, /staleParts\.push\(`새 기록 \$\{stale\.newRecords\}건이 일기에 없어요`\)/);
    assert.match(src, /staleParts\.push\(`사진이 지워져 비운 문단이 \$\{stale\.blankBlocks\}개 있어요`\)/);
    assert.equal((src.match(/staleParts\.join\(' · '\)/g) ?? []).length, 1);
    assert.doesNotMatch(src, /<Notice[^>]*text=\{`(새 기록|사진이 지워져)/);
  });

  test('문단 고치기: 고친 내용이 있으면 닫기를 가로채 저장할지 묻고, 화면은 keyboard를 켠다', () => {
    const src = read(DIARY);
    assert.match(src, /<Screen keyboard>/);
    assert.match(src, /if \(dirty\) setAskSave\(true\)/);
    assert.match(src, /'고친 문장을 저장할까요'/);
    assert.doesNotMatch(src, /gap=\{9\}/, 'SP 토큰을 쓴다');
  });
});

describe('22 기록 지도', () => {
  test("도착 칩 줄 대신 카드 제목 '방문 기록 · 도착 N곳', 목록 줄은 44 이상 눌러 스팟 상세", () => {
    const src = read(RECORD_MAP);
    assert.doesNotMatch(src, /<Chip text=\{`도착/);
    assert.match(src, /`방문 기록 · 도착 \$\{model\.arrivals\}곳`/);
    assert.match(src, /<Pressable\s+accessibilityRole="button"\s+accessibilityLabel=\{visitA11y\(row, name\)\}/);
    assert.match(src, /minHeight: H\.touch/);
    assert.match(src, /`\$\{head\} \$\{name\} \$\{kstHHMM\(row\.t\)\} 도착`/);
    assert.match(src, /onPress=\{\(\) => navigation\.navigate\('SpotDetail', \{ tripId, spotId: r\.spotId \}\)\}/);
    // 누를 수 있게 보이도록 줄 끝에 꺾쇠를 둔다(ListRow와 같은 모양)
    const row = /function VisitRow\([\s\S]*?\n\}/.exec(src);
    assert.ok(row);
    assert.match(row[0], /<Icon name="right" size=\{18\} color="muted" stroke=\{2\} \/>\s*<\/Row>/);
  });

  test('위치 안내는 지도 아래, 시뮬레이터 기록은 지도 위 알약(pointerEvents는 StyleSheet)', () => {
    const src = read(RECORD_MAP);
    assert.ok(src.indexOf('<MapCanvas') < src.indexOf('placeNotices.map'), '위치 안내는 지도 아래');
    assert.match(src, /label="시뮬레이터 기록"/);
    assert.match(src, /simPill: \{[^}]*pointerEvents: 'none'/);
    assert.doesNotMatch(src, /sim: '여행 시뮬레이터로 만든 기록/);
  });

  test("위치 안내 문구는 '~요' 톤이다", () => {
    const src = read(RECORD_MAP);
    const block = /const NOTICE_TEXT[\s\S]*?\n\};/.exec(src);
    assert.ok(block);
    assert.doesNotMatch(block[0], /습니다/);
    assert.equal((block[0].match(/요\.',/g) ?? []).length, 4, '네 안내 모두 ~요로 끝난다');
  });
});
