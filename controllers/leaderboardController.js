// ============================================================================
// controllers/leaderboardController.js — Hall of Fame 조회(read-only)
// ============================================================================
// 리더보드는 클라가 쓰지 못한다. 조회 시 서버가 해당 카테고리/월 스냅샷을 재집계한 뒤
// 결과를 돌려준다(항상 서버 권위 점수). 기본 yearMonth = 현재 달.
// ============================================================================
const { asyncHandler, httpError } = require('../middleware/errorHandler');
const leaderboard = require('../services/leaderboardService');
const { currentYearMonth } = require('../services/recalcService');

function resolveMonth(q) {
  const ym = (q && q.yearMonth) || currentYearMonth();
  if (!/^\d{4}-\d{2}$/.test(ym)) throw httpError(400, 'yearMonth 형식은 YYYY-MM 입니다.');
  return ym;
}

const getCategory = asyncHandler(async (req, res) => {
  const { category } = req.params;
  if (!leaderboard.isValidCategory(category)) {
    throw httpError(400, `category 는 ${leaderboard.CATEGORIES.join('/')} 중 하나여야 합니다.`);
  }
  const yearMonth = resolveMonth(req.query);
  leaderboard.recalc(yearMonth, category);
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  res.json({
    category,
    yearMonth,
    entries: leaderboard.getLeaderboard(category, yearMonth, limit),
  });
});

const getMine = asyncHandler(async (req, res) => {
  const { category } = req.params;
  if (!leaderboard.isValidCategory(category)) {
    throw httpError(400, `category 는 ${leaderboard.CATEGORIES.join('/')} 중 하나여야 합니다.`);
  }
  const yearMonth = resolveMonth(req.query);
  leaderboard.recalc(yearMonth, category);
  res.json(leaderboard.getMyRanking(category, yearMonth, req.uid));
});

module.exports = { getCategory, getMine };
