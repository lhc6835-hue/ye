# PIXEL ARCADE

직접 만든 게임들을 올려두는 픽셀아트 오락실 허브. GitHub Pages에 그대로 올리면 동작하는 정적 사이트예요. 빌드 과정이 없어요.

## 구성

| 경로 | 내용 |
|---|---|
| `index.html` | 메인 사이트 |
| `admin.html` | 게임을 올리고 고치는 관리 페이지 (SERVICE MODE) |
| `data/games.json` | 게임 목록과 사이트 정보. 사이트가 읽는 유일한 데이터 |
| `assets/covers/` | 게임 커버 이미지 (관리 페이지에서 올리면 여기 저장됨) |
| `assets/sprites/` | 상태 배지·NO SIGNAL 화면 스프라이트 시트 |
| `assets/sfx/` | 효과음 (Kenney, CC0) |
| `js/fx.bundle.js` | 직접 만든 픽셀 이펙트 + pixelfx 엔진 번들 |
| `fx-src/` | 위 이펙트들의 원본 소스와 재빌드 스크립트 |

## 주소

https://lhc6835-hue.github.io/ye/

`.github/workflows/pages.yml`이 기본 브랜치에 커밋이 올라올 때마다 사이트를 다시 배포해요 (1~2분).
관리 페이지에서 PUBLISH 해도 커밋이 생기니까 똑같이 자동 반영돼요.

## 게임 올리기 (본인만 가능)

관리 페이지는 `https://<아이디>.github.io/<저장소이름>/admin.html` (사이트 맨 아래 `SERVICE` 링크).

**누가 올릴 수 있나:** GitHub가 직접 판단해요. 관리 페이지는 입력한 토큰으로 GitHub API에 접속해서
"이 계정이 이 저장소에 쓰기 권한이 있는지"를 확인하고, 저장도 GitHub API로 커밋해요.
그래서 저장소에 쓰기 권한이 없는 사람은 페이지에 들어와도 아무것도 못 바꿔요. 사이트 코드 안에는 비밀번호나 토큰이 없어요.

### 토큰 만들기 (처음 한 번)

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
2. Repository access: **Only select repositories** → 이 사이트 저장소 하나만
3. Repository permissions → **Contents: Read and write** (다른 권한은 주지 않기)
4. 만료일은 짧게 (예: 90일)

토큰은 관리 페이지 칸에 붙여넣으면 돼요. 기본은 탭을 닫으면 잊어버리고, "이 기기에서 기억하기"를 켜면 그 브라우저에만 저장돼요.
토큰이 새어나간 것 같으면 GitHub에서 바로 삭제(Revoke)하세요.

### 게임 올리기

1. 관리 페이지에서 **+ 주소로 게임 올리기**
2. 플레이할 수 있는 GitHub 주소를 붙여넣고 **불러오기**
   - `https://아이디.github.io/게임/` (GitHub Pages 주소) 또는 `https://github.com/아이디/게임` (저장소 주소)
   - 저장소 이름, 설명(About), 토픽, 최신 릴리스 태그로 제목·설명·장르·버전을 채워요
   - 저장소 주소를 넣으면 Pages 주소(또는 저장소의 Website 칸)를 찾아서 PLAY 링크로 써요
   - GitHub 밖의 주소(itch.io 등)도 되는데, 그땐 제목과 설명을 직접 적어요
3. 상태(RELEASE / BETA / ALPHA / DEV / SOON)를 고르고 썸네일 넣기: **GIF(움직이는 것 포함), JPEG, PNG, WEBP**, 10MB 이하, 16:10 비율 권장
4. **게시하기** → 저장소에 커밋되고 1~2분 뒤 사이트에 올라가요

올린 뒤에는 왼쪽 목록에서 골라 조작키, 버전 기록, 썸네일 등을 고치고 **PUBLISH** (또는 Ctrl/⌘+S) 하면 돼요.
바꾼 게임의 UPDATED 날짜는 PUBLISH 때 오늘로 자동 갱신되고, 저장 안 한 작업은 브라우저에 임시 저장돼요.

`data/games.json`을 저장소에서 직접 고쳐도 똑같이 반영돼요.

## 로컬에서 보기

`data/games.json`을 fetch로 읽기 때문에 파일을 더블클릭하면 안 열려요. 간단한 서버로 여세요.

```bash
python3 -m http.server 8000
```

그다음 http://localhost:8000

## BGM

기본 BGM `assets/bgm/attract.mp3`는 이 사이트용으로 새로 작곡한 칩튠 루프예요 (A단조, 112 BPM, 약 69초, 끊김 없이 반복).
코드로 합성한 곡이라 다른 사람의 저작권이 없어요. 원본은 `fx-src/bgm/compose.py`이고, 멜로디나 템포를 고쳐서 다시 만들 수 있어요.

```bash
python3 fx-src/bgm/compose.py attract.wav
```

```bash
ffmpeg -i attract.wav -b:a 128k assets/bgm/attract.mp3
```

다른 곡으로 바꾸려면 mp3를 `assets/bgm/`에 넣고 관리 페이지 SITE SETTINGS의 BGM 경로를 바꾸세요.
브라우저 정책 때문에 자동재생은 안 되고, 상단 BGM 버튼으로 켜요. 한 번 켜두면 다음 방문 때 첫 클릭에 이어서 재생돼요.

## 이펙트 수정하기

화면 연출(메인 배경, 코인 투입, CRT 켜짐, PRESS START, 상태 배지, NO SIGNAL)은 전부 이 사이트용으로 새로 만든 pixelfx 이펙트예요.
원본은 `fx-src/arcade/`에 있고, 고친 뒤 아래 스크립트로 번들과 스프라이트 시트를 다시 만들어요.

```bash
git clone https://github.com/patch-gg/pixelfx ../pixelfx
```

```bash
./fx-src/build.sh
```

배지나 NO SIGNAL의 길이·크기를 바꿨다면 `js/sprites.js`의 frames/w/h/cols 값도 맞춰주세요.

## 키보드

| 키 | 동작 |
|---|---|
| `5` | 코인 넣기 |
| `1` | 1P START (추천 게임 열기, 크레딧 1 소모) |
| 방향키 | 게임 카드 선택 |
| `Enter` | 게임 정보 열기 |
| `Esc` | 닫기 |

## 크레딧

- 픽셀 이펙트 엔진: [pixelfx](https://github.com/patch-gg/pixelfx) (MIT, `licenses/pixelfx-MIT.txt`)
- 효과음: [Kenney](https://kenney.nl) Interface Sounds 외 (CC0, `licenses/`)
- BGM: 이 사이트 전용 오리지널 (`fx-src/bgm/compose.py`)
- 글꼴: [Galmuri](https://github.com/quiple/galmuri) (SIL OFL 1.1, `licenses/LICENSE-Galmuri-OFL.txt`)
