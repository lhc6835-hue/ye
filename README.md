# CATCHUTE

낙하산을 멘 고양이가 밤의 골목 빌딩 사이로 끝없이 떨어지는 픽셀아트 러너 게임이에요.

## 조작

| 입력 | 동작 |
|---|---|
| 마우스 왼쪽 버튼 누르고 있기 (또는 Space) | 낙하산 펼치기: 천천히 떨어짐 |
| 버튼 떼기 | 낙하산 접기: 빠르게 다이브 |
| A / D 또는 ← / → | 좌우 이동 |
| M | 소리 켜기/끄기 |
| R | 결과 화면에서 바로 재시작 |

## 규칙

- 떨어진 깊이(m)가 점수예요.
- 낙하산은 오래 못 펴요. 펴고 있으면 고양이 머리 위 게이지가 2초 만에 바닥나고, 다 떨어지면 강제로 접혀요(NO AIR!). 다이브하는 동안 다시 차요.
- 낙하산을 접고 다이브하는 동안 배율이 0.8초마다 올라가요(최대 x9). 낙하산을 펴는 순간 x1로 돌아가요.
- 다이브 중에 장애물을 아슬아슬하게 스치면 `CLOSE!` 보너스를 받아요.
- 물고기를 먹으면 50 × 배율 점수를 받아요.
- 발코니, 실외기, 빨랫줄의 빨래, 네온 간판, 새에 부딪히면 끝나요.
- 깊이 내려갈수록 다이브 속도와 장애물 밀도가 올라가요(1500m에서 최고 난이도). 650m마다 건물 색이 바뀌어요.
- 새는 화면에 들어오기 전에 벽 쪽에 `!` 경고가 깜빡여요.
- 어떤 줄이든 앞 줄에서 낙하산을 펴고 옮겨 갈 수 있는 거리 안에 빈틈이 생겨요. 그래서 못 깨는 구간은 없어요.

## 실행

바로 플레이: https://lhc6835-hue.github.io/ye/

`main`이나 `claude/tender-goldberg-xoww3e` 브랜치에 푸시하면 `.github/workflows/pages.yml`이 빌드해서 GitHub Pages에 자동으로 올려요.

개발할 때는 ES 모듈이라 로컬 서버가 필요해요.

```bash
python3 -m http.server 8000
```

그다음 `http://localhost:8000` 접속.

배포용 빌드(`dist/index.html`과 `dist/assets`):

```bash
npm install
npm run build
```

스프라이트 미리보기 PNG(`records/sprites.png`):

```bash
npm run preview
```

## 구조

- `src/sprites.js` 고양이 도트. 레퍼런스 시트의 22×14 옆모습을 그대로 따르고, 털색 역할(외곽선/베이스/줄무늬 등)로 그려서 팔레트만 바꾸면 다른 털색도 만들 수 있어요. 게임에서는 노란 치즈냥(GINGER)만 써요.
- `src/cat.js` 낙하 물리, 낙하산, 바람에 날리는 스카프
- `src/world.js` 골목 배경(패럴랙스 먼 벽, 벽돌 옆벽), 장애물 생성과 그리기
- `src/game.js` 상태(타이틀/플레이/결과), 점수, 배율, 충돌, HUD
- `src/audio.js` 효과음(WebAudio로 겹쳐 재생, 피치 변화)과 배경음악
- `assets/audio/` CC0 효과음과 배경음악("Lights at Night" by Tsorthan Grove). 출처는 `assets/audio/CREDITS.md`에 있어요.
- `vendor/pixelfx/` [pixelfx](https://github.com/patch-gg/pixelfx) (MIT) 코어와 게임에서 쓰는 이펙트: 새(critters/bird), 사망 연기(spawn/poof), 물고기 획득(pickups/collect-burst), 배율 연출(ui/combo-counter), 새 충돌 깃털(holy/feather-burst). 라이선스와 고지는 `vendor/pixelfx/LICENSE`, `NOTICE.md`에 있어요.
- `.claude/skills/pixelfx/` pixelfx Claude Code 스킬
