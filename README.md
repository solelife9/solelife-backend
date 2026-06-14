# SoleLife 백엔드 서버

## 설치 및 실행

```bash
# 패키지 설치
npm install

# 서버 시작
npm start

# 개발 모드 (자동 재시작)
npm run dev
```

서버는 http://localhost:3001 에서 실행됩니다.

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | /api/auth | 기기 등록 / 로그인 |
| GET | /api/shoes?user_id= | 러닝화 목록 조회 |
| POST | /api/shoes | 러닝화 등록 |
| DELETE | /api/shoes/:id | 러닝화 삭제 |
| GET | /api/runs?user_id= | 런 기록 조회 |
| POST | /api/runs | 런 기록 추가 |
| DELETE | /api/runs/:id | 런 기록 삭제 |
| GET | /api/shoes/search?q= | 신발 자동완성 검색 |

## 무료 클라우드 배포 (Railway)

1. [railway.app](https://railway.app) 회원가입
2. "New Project" → "Deploy from GitHub repo" 선택
3. 이 폴더를 GitHub에 push
4. 자동 배포 완료 → URL 복사
5. 프론트엔드 index.html의 API_BASE 변수에 URL 입력

## 데이터베이스

SQLite 파일 (solelife.db) — 서버 폴더에 자동 생성됨
기기 ID 기반으로 데이터를 분리 저장합니다.

전체 스키마(기존 users·shoes·runs + v1 게이미피케이션 테이블)는 `models/db.js` 한 곳이
소유합니다. 기존 테이블/데이터는 절대 파괴하지 않습니다(CREATE IF NOT EXISTS + 멱등 ALTER).

---

## KEEGO Progression 백엔드 v1 (멀티유저 랭크/타이틀/업적/챌린지/리더보드)

모듈식 구조로 추가된 멀티유저 게이미피케이션 레이어입니다. 기존 `/api/auth`·`/api/shoes`·
`/api/runs` 는 그대로 두고, 새 기능은 **`/api/v1`** 아래에만 추가했습니다.

```
models/db.js          단일 SQLite 연결 + 전체 스키마(기존 보존 + v1 테이블)
middleware/           auth(Firebase ID 토큰 검증) · errorHandler
services/             rankService(앱 rank.ts 미러) · statsService · achievements ·
                      titles · challenges · leaderboard · recalc(오케스트레이터) · firebaseAdmin
controllers/          users · stats · achievements · titles · challenges · leaderboard
routes/index.js       /api/v1 라우터(전부 인증 필수, 리더보드 read-only)
```

### 보안 (필수)
- 모든 `/api/v1` 보호 라우트는 `Authorization: Bearer <Firebase ID Token>` 을 검증합니다.
- 본인 데이터만 수정합니다 — 서버는 토큰에서 검증한 `uid` 만 신뢰하고, 클라가 보낸 uid 바디는 무시합니다.
- 리더보드는 read-only(클라 쓰기 불가).
- **클라가 제출한 점수/랭크를 신뢰하지 않습니다.** 서버가 검증된 `shoes`/`runs` 로 랭크·포인트·
  업적·통계를 **재계산**합니다(`POST /api/v1/stats/recalculate`).

### 식별자 브릿지 (설계 결정)
기존 데이터는 device 기반(`users.id` = uuid, `users.device_id`)인데 v1 은 **Firebase UID** 를
주 식별자로 씁니다. 둘을 잇기 위해 `users.firebase_uid` 컬럼을 추가했고, 앱은 로그인 후
`POST /api/v1/users/me/link { deviceUserId }` 로 기존 device 계정을 자신의 Firebase UID 에
연결합니다. 그 뒤 서버측 재계산이 `firebase_uid → users.id → shoes/runs` 로 검증된 데이터를 모읍니다.
연결 전이면 통계는 0(빈 프로필)으로 안전하게 동작합니다.

### v1 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET  | /api/v1/health | 헬스(인증 불필요) |
| GET  | /api/v1/users/me | 내 프로필(없으면 생성) |
| PATCH| /api/v1/users/me | 닉네임·프로필이미지 수정 |
| POST | /api/v1/users/me/link | device 계정 → Firebase UID 연결 + 재계산 |
| GET  | /api/v1/stats/me/monthly?yearMonth= | 월간 통계 |
| POST | /api/v1/stats/recalculate | 서버측 전체 재계산 |
| GET  | /api/v1/achievements/me | 내 업적 + 카탈로그 |
| POST | /api/v1/achievements/recalculate | 업적 재계산 |
| GET  | /api/v1/titles/me | 내 타이틀 + 카탈로그 |
| PATCH| /api/v1/titles/equip | 타이틀 장착(단 하나) |
| GET  | /api/v1/challenges/me?yearMonth= | 챌린지 진행도 |
| POST | /api/v1/challenges/recalculate | 챌린지 재계산 |
| GET  | /api/v1/leaderboards/:category?yearMonth=&limit= | 리더보드 top N |
| GET  | /api/v1/leaderboards/:category/me?yearMonth= | 내 순위(top%·nearby ±2) |

리더보드 카테고리: `distance` · `consistency` · `rotation` · `shoeHealth` · `collection` · `progressPoints`

### 랭크 산정 (앱과 동기화)
`services/rankService.js` 는 앱 `lib/progression/rank.ts` 를 1:1 미러링합니다(가중치·포화 기준·
티어 컷오프·색상·포인트). 6개 평가축 가중합(running .25 / consistency .20 / shoeManagement .20 /
rotation .15 / injuryPrevention .10 / engagement .10) → 0..100 → 7티어. **거리 단독으로는 Silver
하한(25점)을 넘지 못하도록** 설계되어, 신발관리·로테이션·일관성 등 多차원이 상위 티어를 만듭니다.

### 환경변수
- `FIREBASE_SERVICE_ACCOUNT` — Firebase 서비스계정 JSON(문자열 통째). ID 토큰 검증/커스텀
  토큰 발급에 필요. 미설정 시 v1 보호 라우트는 503 으로 응답합니다. (배포 환경에서 설정)
- `PORT` — 기본 3001.

### 실행/테스트 주의
- **Node 20.x 권장**(`package.json` engines). `better-sqlite3` 가 Node 24 에서 빌드 실패합니다.
- 전체 통합 테스트(부팅 + 엔드포인트)는 의존성 설치 + Node 20 환경(= Render 배포 환경)에서
  수행하세요. 순수 랭크 로직(`services/rankService.js`)은 의존성 없이 단독 검증 가능합니다.
