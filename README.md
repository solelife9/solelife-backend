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
