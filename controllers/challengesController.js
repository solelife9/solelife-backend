// ============================================================================
// controllers/challengesController.js — 챌린지 진행도 조회 + 재계산
// ============================================================================
const { asyncHandler } = require('../middleware/errorHandler');
const challenges = require('../services/challengesService');
const { recalcUser } = require('../services/recalcService');
const { ensureProfile } = require('./usersController');

const getMine = asyncHandler(async (req, res) => {
  ensureProfile(req.uid);
  const { yearMonth } = req.query;
  res.json({ progress: challenges.listForUser(req.uid, yearMonth), catalog: challenges.catalog() });
});

const recalc = asyncHandler(async (req, res) => {
  recalcUser(req.uid);
  res.json({ recalculated: true, progress: challenges.listForUser(req.uid) });
});

module.exports = { getMine, recalc };
