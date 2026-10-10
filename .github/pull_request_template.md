<!-- 크기 사유: (400줄 초과일 때만, 첫 줄. release PR은 해당 없음) -->
<!-- 공유 파일: (FOUNDATION 경로가 있으면 전부) -->
<!-- 베이스: feature/* → develop(Squash). release/*·hotfix/* → main(머지 커밋), 태그 뒤 같은 브랜치 → develop(머지 커밋) -->

## 무엇을 했나

<!-- 한두 줄. 왜 필요했는지까지. fix면 증상/원인/수정 -->

Closes #

## 어떻게 확인했나

<!-- 수동 체크리스트 해당 행: - [x] <key>: <본 것> — <기기, OS> -->

- [ ] 베이스 브랜치 맞음 (feature는 `develop`, release·hotfix는 `main` 다음 `develop`)
- [ ] `npm run gate:wp -- WP<n>` 통과 (바꾼 WP마다. FOUNDATION만 바꿨으면 `해당 없음`)
- [ ] `npm run typecheck && npm test && npm run export:web` 통과, ttf 4개
- [ ] 상대 영역 화면 하나 열어 봄

## 함께 고친 것

<!-- 20줄 미만 곁가지 수정만. 없으면 지움 -->

## 리뷰할 때 봐줬으면 하는 곳

## 화면

<!-- UI를 바꿨으면 스크린샷. 아니면 지움 -->
