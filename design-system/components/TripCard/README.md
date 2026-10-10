# TripCard

사진이 주인공인 카드(여행방, 장소, 추천 여행지). 카드에는 테두리도 그림자도 없다. 사진 모서리만 radius-lg.

- `image`가 없으면 연회색 자리에 핀과 장소 이름을 둔다. 색 면이나 무늬로 사진을 흉내 내지 않는다.
- 사진 위에는 왼쪽 위 `badge` 하나, 오른쪽 위 저장 하트 하나까지.
- 아래 글자는 제목(body-strong) 한 줄과 보조(body-sm, ink-muted) 한두 줄.
- `size="lg"`는 홈 가로 줄의 내 여행, 기본은 추천·장소 격자.
- 소비자 제공: `title`, `lines`, `image` 또는 `place`, 필요하면 `badge`, `saved`/`onToggleSave`, `footer`.
