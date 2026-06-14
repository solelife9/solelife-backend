// ============================================================================
// routes/index.js — /api/v1 라우터(KEEGO Progression 백엔드 v1)
// ============================================================================
// 모든 v1 라우트는 Firebase ID 토큰 검증을 거친다(requireAuth). 리더보드는 read-only
// (GET 만). 본인 데이터만 수정(컨트롤러가 req.uid 만 신뢰).
//
// 라우트 등록 순서 주의: '/leaderboards/:category/me' 를 '/leaderboards/:category'
// 보다 먼저 둔다(더 구체적인 경로 우선 매칭).
// ============================================================================
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const users = require('../controllers/usersController');
const stats = require('../controllers/statsController');
const achievements = require('../controllers/achievementsController');
const titles = require('../controllers/titlesController');
const challenges = require('../controllers/challengesController');
const leaderboard = require('../controllers/leaderboardController');

const router = express.Router();

// 헬스(인증 불필요) — 배포 진단용.
router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'keego-progression-v1', ts: Date.now() });
});

// 이하 전부 인증 필수.
router.use(requireAuth);

// Users / profile
router.get('/users/me', users.getMe);
router.patch('/users/me', users.patchMe);
router.post('/users/me/link', users.linkDevice);

// Stats
router.get('/stats/me/monthly', stats.getMyMonthly);
router.post('/stats/recalculate', stats.recalculate);

// Achievements
router.get('/achievements/me', achievements.getMine);
router.post('/achievements/recalculate', achievements.recalc);

// Titles
router.get('/titles/me', titles.getMine);
router.patch('/titles/equip', titles.equip);

// Challenges
router.get('/challenges/me', challenges.getMine);
router.post('/challenges/recalculate', challenges.recalc);

// Leaderboards (read-only) — /me 를 먼저 등록.
router.get('/leaderboards/:category/me', leaderboard.getMine);
router.get('/leaderboards/:category', leaderboard.getCategory);

module.exports = router;
