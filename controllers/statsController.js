// ============================================================================
// controllers/statsController.js — 월간 통계 조회 + 서버측 재계산
// ============================================================================
const db = require('../models/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { recalcUser } = require('../services/recalcService');
const { ensureProfile } = require('./usersController');

const getMyMonthly = asyncHandler(async (req, res) => {
  ensureProfile(req.uid);
  const { yearMonth } = req.query;
  let rows;
  if (yearMonth) {
    rows = db
      .prepare('SELECT * FROM monthly_stats WHERE uid = ? AND year_month = ? ORDER BY year_month DESC')
      .all(req.uid, yearMonth);
  } else {
    rows = db
      .prepare('SELECT * FROM monthly_stats WHERE uid = ? ORDER BY year_month DESC')
      .all(req.uid);
  }
  res.json(rows);
});

// 서버가 검증된 shoes/runs 로 전부 재계산(클라 제출 점수 불신).
const recalculate = asyncHandler(async (req, res) => {
  const profile = recalcUser(req.uid);
  res.json({ recalculated: true, profile });
});

module.exports = { getMyMonthly, recalculate };
