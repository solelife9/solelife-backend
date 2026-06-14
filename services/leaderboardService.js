// ============================================================================
// services/leaderboardService.js — Hall of Fame / 리더보드 집계(서버 권위, read-only)
// ============================================================================
// 모든 사용자의 user_profiles + monthly_stats 에서 카테고리별 점수를 모아 정렬·순위
// 부여해 leaderboard_entries 에 스냅샷한다. 점수는 서버가 재계산한 값만 쓴다(클라 불신).
// 조회는 top3 / top100 / 내순위(top%·nearby ±2) 를 제공한다.
//
// 카테고리: distance / consistency / rotation / shoeHealth / collection / progressPoints
// ============================================================================
const db = require('../models/db');

const CATEGORIES = ['distance', 'consistency', 'rotation', 'shoeHealth', 'collection', 'progressPoints'];

function isValidCategory(c) {
  return CATEGORIES.includes(c);
}

// 카테고리별 점수 추출(프로필 + 해당 월 monthly 조인 결과 행 기준).
function scoreFor(category, row) {
  switch (category) {
    case 'distance':
      return Number(row.distance_km) || 0;
    case 'consistency':
      return Number(row.active_days) || 0;
    case 'rotation':
      return Number(row.rotation_score) || 0;
    case 'shoeHealth':
      return Number(row.shoe_health_score) || 0;
    case 'collection':
      return Number(row.total_shoes) || 0;
    case 'progressPoints':
      return Number(row.progress_points_profile) || 0;
    default:
      return 0;
  }
}

/**
 * 특정 월의 한 카테고리(또는 전체) 리더보드를 재계산해 스냅샷한다.
 * @param {string} yearMonth 'YYYY-MM'
 * @param {string} [onlyCategory] 주면 그 카테고리만, 없으면 전체.
 */
function recalc(yearMonth, onlyCategory) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth || '')) throw new Error('invalid yearMonth');
  const cats = onlyCategory ? [onlyCategory].filter(isValidCategory) : CATEGORIES;
  if (cats.length === 0) throw new Error('invalid category');

  // 프로필 ⨝ 해당 월 monthly(없는 달은 0). progress_points 는 프로필 누적값 사용.
  const rows = db
    .prepare(
      `SELECT p.uid AS uid, p.nickname AS nickname, p.rank AS rank_tier,
              p.rank_color AS rank_color, p.equipped_title AS equipped_title,
              p.total_shoes AS total_shoes, p.progress_points AS progress_points_profile,
              COALESCE(m.distance_km, 0) AS distance_km,
              COALESCE(m.active_days, 0) AS active_days,
              COALESCE(m.rotation_score, 0) AS rotation_score,
              COALESCE(m.shoe_health_score, 0) AS shoe_health_score
       FROM user_profiles p
       LEFT JOIN monthly_stats m ON m.uid = p.uid AND m.year_month = ?`,
    )
    .all(yearMonth);

  const upsert = db.prepare(
    `INSERT INTO leaderboard_entries
       (uid, year_month, category, rank, score, nickname, rank_tier, rank_color, equipped_title, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(uid, year_month, category) DO UPDATE SET
       rank = excluded.rank, score = excluded.score, nickname = excluded.nickname,
       rank_tier = excluded.rank_tier, rank_color = excluded.rank_color,
       equipped_title = excluded.equipped_title, updated_at = datetime('now')`,
  );

  const tx = db.transaction(() => {
    for (const category of cats) {
      const ranked = rows
        .map(r => ({ ...r, score: scoreFor(category, r) }))
        .sort((a, b) => b.score - a.score);
      // 기존 스냅샷을 지우고 다시 써서 떠난 유저/0점 잔재가 남지 않게 한다.
      db.prepare('DELETE FROM leaderboard_entries WHERE year_month = ? AND category = ?').run(
        yearMonth,
        category,
      );
      ranked.forEach((r, i) => {
        upsert.run(
          r.uid,
          yearMonth,
          category,
          i + 1,
          r.score,
          r.nickname || '',
          r.rank_tier || 'bronze',
          r.rank_color || '#CD7F32',
          r.equipped_title || '',
        );
      });
    }
  });
  tx();
}

/** top N(기본 100). */
function getLeaderboard(category, yearMonth, limit = 100) {
  if (!isValidCategory(category)) throw new Error('invalid category');
  const n = Math.max(1, Math.min(500, Number(limit) || 100));
  return db
    .prepare(
      `SELECT uid, rank, score, nickname, rank_tier, rank_color, equipped_title
       FROM leaderboard_entries WHERE category = ? AND year_month = ?
       ORDER BY rank ASC LIMIT ?`,
    )
    .all(category, yearMonth, n);
}

/** 내 순위 + top% + nearby(위2/나/아래2). 미참여면 available:false. */
function getMyRanking(category, yearMonth, uid) {
  if (!isValidCategory(category)) throw new Error('invalid category');
  const total = db
    .prepare('SELECT COUNT(*) AS n FROM leaderboard_entries WHERE category = ? AND year_month = ?')
    .get(category, yearMonth);
  const totalN = total ? Number(total.n) : 0;
  const me = db
    .prepare(
      `SELECT uid, rank, score, nickname, rank_tier, rank_color, equipped_title
       FROM leaderboard_entries WHERE category = ? AND year_month = ? AND uid = ?`,
    )
    .get(category, yearMonth, uid);
  if (!me) {
    return { available: false, category, yearMonth, total: totalN, me: null, nearby: [] };
  }
  const topPercent = totalN > 0 ? Math.round((me.rank / totalN) * 1000) / 10 : null;
  const nearby = db
    .prepare(
      `SELECT uid, rank, score, nickname, rank_tier, rank_color, equipped_title
       FROM leaderboard_entries WHERE category = ? AND year_month = ?
       AND rank BETWEEN ? AND ? ORDER BY rank ASC`,
    )
    .all(category, yearMonth, Math.max(1, me.rank - 2), me.rank + 2);
  return { available: true, category, yearMonth, total: totalN, topPercent, me, nearby };
}

module.exports = { CATEGORIES, isValidCategory, recalc, getLeaderboard, getMyRanking };
