// ============================================================================
// controllers/achievementsController.js — 업적 조회 + 재계산
// ============================================================================
const { asyncHandler } = require('../middleware/errorHandler');
const achievements = require('../services/achievementsService');
const { recalcUser } = require('../services/recalcService');
const { ensureProfile } = require('./usersController');

const getMine = asyncHandler(async (req, res) => {
  ensureProfile(req.uid);
  res.json({ unlocked: achievements.listForUser(req.uid), catalog: achievements.catalog() });
});

// 전체 재계산(업적은 컨텍스트 종속이라 통합 재계산으로 일관성 유지) 후 목록 반환.
const recalc = asyncHandler(async (req, res) => {
  recalcUser(req.uid);
  res.json({ recalculated: true, unlocked: achievements.listForUser(req.uid) });
});

module.exports = { getMine, recalc };
