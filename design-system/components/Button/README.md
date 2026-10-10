# Button

화면의 주 동작은 `primary`(brand 면) 하나, 나머지는 `secondary`(잉크 테두리)나 `text`(밑줄).

- 라벨은 동사로 끝내고 짧게: "여행방 만들기", "시간표 보기".
- 하단 고정 버튼은 `block`. 두 개를 나란히 둘 때는 왼쪽 `secondary`, 오른쪽 `primary`.
- 삭제·나가기도 `secondary` + 확인 시트. 빨간 버튼은 없다.
- 비활성은 회색 면(surface-soft)과 ink-muted 글자.
- 소비자 제공: 라벨(children), `onClick`, 필요하면 `variant`, `size`, `icon`, `block`.
