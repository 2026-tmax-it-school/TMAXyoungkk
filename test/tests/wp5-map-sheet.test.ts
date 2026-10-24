import assert from 'node:assert/strict';
import { test } from 'node:test';

import { read, stripComments } from './setup/scan';

/**
 * 11 지도 탭 · 13 구간 안내 · 27 길찾기 배치(UX 점검 B7, 2026-10-12).
 * 지도 탭 시트는 공용 PeekSheet이고, 지도 위에는 여행방 칩과 '길찾기' 알약만 둔다. 핀과 목록은 상세로 바로 가지 않고 스팟을 고른다.
 * 13은 루트 계산 전에도 막다른 화면이 아니고, 진행 중이면 구간을 따라가되 사용자가 넘긴 뒤에는 따라가지 않는다.
 * 27은 끝점이 비면 위치를 읽지 않는 바로 고르기 목록을 보인다. 세 화면 모두 소스 규칙으로 고정한다.
 */

const map = stripComments(read('src/screens/MapScreen.tsx'));
const nav = stripComments(read('src/screens/NavigateScreen.tsx'));
const dir = stripComments(read('src/screens/DirectionsScreen.tsx'));

test('11 지도 탭: 하단 시트는 PeekSheet(peek·full, 지도 높이의 60%)이고 지도 위 목록 버튼이 없다', () => {
  assert.match(map, /<PeekSheet\b/);
  assert.match(map, /const SNAPS: readonly SheetSnap\[\] = \['peek', 'full'\];/);
  assert.match(map, /const SHEET_MAX_RATIO = 0\.6;/);
  assert.match(map, /areaHeight=\{mapH\}/);
  assert.match(map, /maxRatio=\{SHEET_MAX_RATIO\}/);
  assert.doesNotMatch(map, /<IconBtn[^>]*icon="list"/, "지도 위 'list' IconBtn은 지웠다");
  // 고정 높이 460으로 펼치지 않는다
  assert.doesNotMatch(map, /maxHeight: expanded \? 460/);
  // 머리 줄 하나가 접고 편다(누르는 높이 44, 펼침 상태를 알린다)
  assert.match(map, /accessibilityState=\{\{ expanded \}\}/);
  assert.match(map, /onPress=\{\(\) => setSnap\(expanded \? 'peek' : 'full'\)\}/);
  assert.match(map, /head: \{[\s\S]*?minHeight: H\.touch/);
  // 접힌 시트의 '제외 스팟 N곳'은 펼치는 버튼이다
  assert.match(map, /<Btn title=\{`제외 스팟 \$\{excluded\.length\}곳`\} size="sm" variant="quiet" onPress=\{\(\) => setSnap\('full'\)\}/);
  // 스팟 목록은 펼쳤을 때만, 줄 높이 44
  assert.match(map, /\{expanded && day && rows\.length > 0 \?/);
  assert.match(map, /listRow: \{[\s\S]*?minHeight: H\.touch/);
});

test('11 지도 탭: 방은 useActiveTrip과 TripBar 칩, 길찾기는 MapPill, 날짜 칩·수단 칩은 없다', () => {
  assert.match(map, /const \{ trip \} = useActiveTrip\(\);/);
  assert.doesNotMatch(map, /useCurrentTrip/);
  assert.match(map, /<TripBar variant="chip" \/>/);
  assert.match(map, /<MapPill icon="nav" label="길찾기" onPress=\{\(\) => navigation\.navigate\('Directions', \{ tripId \}\)\}/);
  assert.doesNotMatch(map, /<Chip text=\{TRANSPORT_LABEL/, '수단 칩은 시트 요약 줄로 옮겼다');
  assert.doesNotMatch(map, /'전체 날짜'\} tone=/, '날짜 칩은 시트 Seg와 겹치므로 지웠다');
  // 지도 위 줄은 빈 곳의 누름을 지도에 넘긴다(StyleSheet의 pointerEvents)
  assert.match(map, /top: \{[\s\S]*?pointerEvents: 'box-none'/);
});

test('11 지도 탭: 넘겨받은 날짜(route.params.date)로 다시 열면 따라간다(같은 날짜를 다시 넘겨도)', () => {
  assert.match(map, /const paramDate = route\.params\?\.date;/);
  // 값이 아니라 params 객체에 걸어 '전체'로 바꾼 뒤 같은 날짜로 다시 열어도 그 날짜로 돌아온다
  assert.match(map, /const params = route\.params;\s*useEffect\(\(\) => \{\s*const d = params\?\.date;\s*if \(d\) setPicked\(d\);\s*\}, \[params\]\);/);
  assert.doesNotMatch(map, /\}, \[paramDate\]\);/);
});

test('11 지도 탭: 핀·목록은 스팟을 고르고(다시 누르면 풀림), 고른 스팟으로 맞추고, 카드에서 상세·구간 안내·길찾기로 간다', () => {
  assert.match(map, /onMarkerPress=\{pressMarker\}/);
  // 같은 핀을 다시 누르면 풀고, 새로 고르면 목록 줄처럼 시트를 접는다(펼친 목록 아래에 카드가 숨지 않게)
  assert.match(map, /if \(selected === id\) \{\s*setSelected\(undefined\);\s*return;\s*\}\s*setSelected\(id\);\s*setSnap\('peek'\);/);
  // 겹친 스팟 목록에서 고른 것은 다시 누르기가 아니다. 이미 고른 스팟을 목록에서 골라도 선택이 풀리지 않는다
  assert.match(map, /onClusterPick=\{\(id\) => \{\s*if \(!isBase\(id\)\) pickRow\(id\);\s*\}\}/);
  for (const f of ['MapCanvas.tsx', 'GoogleMapView.tsx', 'GoogleMapView.web.tsx', 'KakaoMapView.tsx', 'KakaoMapView.web.tsx']) {
    assert.match(read(`src/components/map/${f}`), /onPick=\{\(id\) => \((props|latest\.current)\.onClusterPick \?\? \1\.onMarkerPress\)\?\.\(id\)\}/, f);
  }
  assert.match(map, /if \(selected\) sheetScroll\.current\?\.scrollTo\(\{ y: 0, animated: false \}\);/);
  assert.match(map, /<ScrollView ref=\{sheetScroll\}/);
  // 고른 동안은 날짜 Seg를 접어 360px 접힌 시트에서도 카드 버튼 줄이 보인다
  assert.match(map, /\{segItems\.length > 2 && !selected \? <Seg /);
  assert.match(map, /fitTo=\{fitTo\}/);
  assert.match(map, /pickedMarker \? \[pickedMarker\.coord\] : undefined/);
  assert.match(map, /<IconBtn icon="x" label="선택 풀기"/);
  assert.match(map, /title="상세 보기"/);
  assert.match(map, /title="구간 안내"/);
  assert.match(map, /title="여기까지 길찾기"/);
  assert.match(map, /navigation\.navigate\('Directions', \{ tripId, toSpotId: selected \}\)/);
  // 상세는 카드의 '상세 보기'로만 간다(핀을 누르면 바로 가지 않는다)
  assert.equal((map.match(/navigate\('SpotDetail'/g) ?? []).length, 1);
  // 카드의 도착·체류·앞 구간 한 줄
  assert.match(map, /`도착 \$\{it\.arrive\}`, `체류 \$\{humanMin\(it\.stayMin\)\}`/);
  assert.match(map, /`앞 구간 \$\{humanMin\(it\.travelMin\)\}`/);
});

test('11 지도 탭: 루트 계산 전 후보를 골라도 카드에 이름이 있고, 어디에도 없는 스팟이면 선택을 푼다', () => {
  // 이름은 계획 → 제외 → 여행방 후보(trip.spots) 순으로 찾는다. 빈 이름 카드('', 루트 계산 전 후보)를 그리지 않는다
  assert.match(map, /findPlanned\(plan, spotId\)\?\.item\.name \?\?\s*plan\?\.excluded\.find\(\(x\) => x\.spotId === spotId\)\?\.name \?\?\s*trip\.spots\.find\(\(s\) => s\.id === spotId && !s\.removedByUser\)\?\.name/);
  assert.doesNotMatch(map, /ex\?\.name \?\? ''/);
  assert.match(map, /const selectedName = selected && trip \? spotNameOf\(trip, plan, selected\) : undefined;/);
  assert.match(map, /if \(selected && selectedName === undefined\) setSelected\(undefined\);/);
  assert.match(map, /\{selected && selectedName !== undefined \? \(\s*<PickedCard\s+spotId=\{selected\}\s+name=\{selectedName\}/);
  // 카드 글 묶음은 스크린리더가 한 번에 읽고(accessible), 순번 원은 숨긴다(이름에 'n번째'가 있다)
  const card = map.slice(map.indexOf('function PickedCard('), map.indexOf('const styles = StyleSheet.create'));
  assert.match(card, /<View\s+accessible\s+accessibilityLabel=\{planned \? `\$\{planned\.index \+ 1\}번째 스팟/);
  assert.match(card, /<View style=\{styles\.numDot\} aria-hidden>/);
});

test('11 지도 탭: 진행 중이면 한 줄(다음 스팟·예상 시각)이 여행 진행 버튼 자리에 있고 19로 간다. 금지 문구가 없다', () => {
  assert.match(map, /`진행 중 · 다음 \$\{timing\.name\} · 예상 \$\{etaView\(timing\)\.eta\}`/);
  assert.match(map, /const openLive = \(\) => navigation\.navigate\('LiveTrip', \{ tripId, date: liveDate \}\);/);
  assert.match(map, /\{liveHere \? null : \(/);
  assert.doesNotMatch(map, /늦었습니다|지연되었습니다|서두르세요/);
  // OSM 출처 줄은 지우지 않는다(라이선스 표기)
  assert.match(map, /길 데이터 OpenStreetMap 기여자/);
});

test('13 구간 안내: 한 줄 머리말, 루트 계산 전 빈 상태의 다음 행동, 구간 머리, 진행 중 따라가기', () => {
  assert.match(nav, /<Header size="row" back=\{back\} eyebrow=\{`구간 안내 · \$\{dayLabel\(date\)\}`\}/);
  assert.match(nav, /const back = useBack\('Map'\);/);
  assert.doesNotMatch(nav, /canGoBack\(\)/);
  assert.match(nav, /<NotFound title="여행방을 찾을 수 없어요"/);
  // 빈 상태에 '루트 계산'(08)
  assert.match(nav, /action=\{\{ label: '루트 계산', onPress: \(\) => navigation\.navigate\('Planning', \{ tripId, date \}\) \}\}/);
  // 구간 머리 '구간 2/5 · 석굴암까지'와 분(nmLg accent)
  assert.match(nav, /`구간 \$\{pos \+ 1\}\/\$\{legs\.length\} · \$\{leg\.toName\}까지`/);
  assert.match(nav, /<Txt v="nmLg" c="accent">\{`\$\{leg\.minutes\}분`\}<\/Txt>/);
  // 출발지는 눈에도 보이고(구간 머리 아래 줄), 묶음 이름은 accessible View에 있어 스크린리더가 읽는다
  assert.match(nav, /<View accessible accessibilityLabel=\{`\$\{legTitle\}, \$\{leg\.fromName\}에서 출발`\}/);
  assert.match(nav, /<Txt v="mtTight" numberOfLines=\{1\}>\s*\{`\$\{leg\.fromName\}에서 출발`\}/);
  // 진행 중이면 다음 스팟 구간으로 따라가고, 사용자가 넘긴 뒤에는 따라가지 않는다
  assert.match(nav, /const userPaged = useRef\(false\);/);
  assert.match(nav, /if \(!nextSpotId \|\| userPaged\.current\) return;/);
  assert.match(nav, /const page = \(index: number\) => \{\s*userPaged\.current = true;/);
  assert.doesNotMatch(nav, /onPress=\{\(\) => \{\s*if \(has(Prev|Next)\) setLegIndex/, '이전·다음은 page로 넘긴다');
});

test('13 구간 안내: 버튼은 Foot. 진행 중이면 카카오맵으로 열기 하나, 아니면 카카오맵(quiet)과 여행 진행 시작', () => {
  assert.match(nav, /<Foot>\s*\{liveHere \? \(\s*<Btn title="카카오맵으로 열기"/);
  assert.match(nav, /<Btn title="카카오맵으로 열기" size="sm" variant="quiet" onPress=\{openMapApp\} \/>/);
  assert.match(nav, /<Btn title="여행 진행 시작" icon="play" size="sm" onPress=\{\(\) => navigation\.navigate\('LiveTrip', \{ tripId, date \}\)\}/);
  assert.doesNotMatch(nav, /안내 시작"|지도 앱으로 열기/);
  assert.doesNotMatch(nav, /`길찾기 · /, "13은 '길찾기'가 아니라 '구간 안내'다");
});

test('27 길찾기: 한 줄 머리말·useBack, 끝점 줄 높이 44, 설명 문장 대신 위치를 읽지 않는 바로 고르기 목록', () => {
  assert.match(dir, /<Header size="row" back=\{back\} title="길찾기"/);
  assert.match(dir, /const back = useBack\('Map'\);/);
  assert.doesNotMatch(dir, /canGoBack\(\)/);
  assert.match(dir, /endRow: \{ minHeight: H\.fieldSm, justifyContent: 'center' \}/);
  assert.match(dir, /style=\{styles\.endRow\}/);
  assert.doesNotMatch(dir, /견줘 보여 드립니다/);
  // 비어 있는 쪽의 바로 고르기 목록(기점, 스팟 최대 5곳, 장소 검색, 지도에서 고르기)
  assert.match(dir, /const emptySide: EndpointSide \| undefined = !from \? 'from' : !to \? 'to' : undefined;/);
  assert.match(dir, /const QUICK_SPOTS = 5;/);
  assert.match(dir, /\.slice\(0, QUICK_SPOTS\)/);
  const quick = dir.slice(dir.indexOf('function QuickPick('), dir.indexOf('function EndpointPicker('));
  assert.ok(quick.length > 0, 'QuickPick이 EndpointPicker 앞에 있다');
  assert.match(quick, /title="장소 검색"/);
  assert.match(quick, /title="지도에서 고르기"/);
  assert.doesNotMatch(quick, /readLocationOnce|location|ME_NAME|pickMe/, '바로 고르기 목록은 위치를 읽지 않는다');
  // 반대쪽 끝과 같은 곳(기본 출발인 기점 등)은 목록에 두지 않는다('출발과 도착이 같은 곳' 막다른 길)
  assert.match(dir, /const notOther = \(e: Endpoint\) => !quickOther \|\| routeReady\(\{ from: e, to: quickOther \}\)\.ready;/);
  assert.match(dir, /const quickBase = baseEnd && notOther\(baseEnd\) \? baseEnd : undefined;/);
  assert.match(dir, /base=\{quickBase\}/);
  assert.match(dir, /\.filter\(notOther\)\s*\.slice\(0, QUICK_SPOTS\)/);
  // 지도에서 고르는 동안은 목록을 접고, 목록 높이는 줄 3개 반이라 360px에서도 지도가 남는다
  assert.match(dir, /\{emptySide \? \(\s*mapPick \? null : \(\s*<QuickPick/);
  assert.match(dir, /const QUICK_LIST_MAX_H = H\.touch \* 3\.5;/);
  assert.match(dir, /quickList: \{ flexGrow: 0, maxHeight: QUICK_LIST_MAX_H \}/);
  // 경로가 준비되기 전에는 카카오맵 버튼이 없다(회색 비활성 버튼이 자리만 차지하지 않게)
  assert.doesNotMatch(dir, /disabled=\{!ready\.ready\}/);
});
