// ============================================================================
// services/recalcService.js — uid 전체 재계산 오케스트레이터(서버=진실)
// ============================================================================
// 순서가 중요하다: 업적/타이틀/챌린지를 먼저 판정해 그 결과(포인트·개수)를 컨텍스트의
// engagement 입력으로 주입한 뒤에 랭크를 산정해야 앱과 수치가 맞는다.
//   1) 검증된 DB → 기본 컨텍스트
//   2) 월별 챌린지 재판정(전 기간) → completedChallengeCount
//   3) 업적 재판정 → achievementPoints, 4) 타이틀 재판정 → earnedTitleCount
//   5) 컨텍스트에 engagement 입력 주입 → computeRank
//   6) user_profiles + monthly_stats upsert
// ============================================================================
const db = require('../models/db');
const stats = require('./statsService');
const achievements = require('./achievementsService');
const titles = require('./titlesService');
const challenges = require('./challengesService');
const { computeRank } = require('./rankService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** 현재 yearMonth('YYYY-MM', UTC). */
function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * uid 전체 재계산. 연결된 로컬 데이터가 없으면 빈(zero) 프로필을 보장한다.
 * @returns 갱신된 프로필 행.
 */
function recalcUser(uid) {
  if (!uid) throw new Error('uid required');

  const ctx = stats.buildContext(uid);
  const monthly = stats.monthlyAggregates(uid);

  // 현재 달은 데이터가 없어도 챌린지 0 진행으로 존재하게 한다.
  const cym = currentYearMonth();
  if (!monthly[cym]) {
    monthly[cym] = { distanceKm: 0, runCount: 0, days: new Set(), shoes: new Set() };
  }

  // 월별 챌린지 재판정.
  for (const ym of Object.keys(monthly)) {
    const m = monthly[ym];
    challenges.recalc(uid, ym, {
      distanceKm: m.distanceKm,
      runCount: m.runCount,
      activeDays: m.days.size,
      shoesUsedCount: m.shoes.size,
    });
  }
  const completedChallengeCount = challenges.completedTotal(uid);

  // 업적/타이틀 재판정.
  const ach = achievements.recalc(uid, ctx);
  const ttl = titles.recalc(uid, ctx);

  // engagement 입력 주입 후 랭크 산정.
  ctx.achievementPoints = ach.points;
  ctx.earnedTitleCount = ttl.count;
  ctx.completedChallengeCount = completedChallengeCount;
  const rank = computeRank(ctx);

  // 프로필 upsert — nickname/profile_image_url/equipped_title 는 보존.
  const upsertProfile = db.prepare(
    `INSERT INTO user_profiles
       (uid, rank, rank_color, rank_score, total_distance, total_runs,
        total_shoes, retired_shoes, progress_points, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(uid) DO UPDATE SET
       rank = excluded.rank, rank_color = excluded.rank_color,
       rank_score = excluded.rank_score, total_distance = excluded.total_distance,
       total_runs = excluded.total_runs, total_shoes = excluded.total_shoes,
       retired_shoes = excluded.retired_shoes, progress_points = excluded.progress_points,
       updated_at = datetime('now')`,
  );

  const upsertMonthly = db.prepare(
    `INSERT INTO monthly_stats
       (uid, year_month, distance_km, run_count, active_days, shoes_used_count,
        rotation_score, shoe_health_score, progress_points, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(uid, year_month) DO UPDATE SET
       distance_km = excluded.distance_km, run_count = excluded.run_count,
       active_days = excluded.active_days, shoes_used_count = excluded.shoes_used_count,
       rotation_score = excluded.rotation_score, shoe_health_score = excluded.shoe_health_score,
       progress_points = excluded.progress_points, updated_at = datetime('now')`,
  );

  const tx = db.transaction(() => {
    upsertProfile.run(
      uid,
      rank.tier,
      rank.color,
      round2(rank.score),
      round2(ctx.cumulativeKm),
      ctx.runCount,
      ctx.registeredShoeCount,
      ctx.retiredShoeCount,
      ach.points,
    );
    for (const ym of Object.keys(monthly)) {
      const m = monthly[ym];
      upsertMonthly.run(
        uid,
        ym,
        round2(m.distanceKm),
        m.runCount,
        m.days.size,
        m.shoes.size,
        round2(rank.pillars.rotation),
        round2(rank.pillars.shoeManagement),
        ach.points,
      );
    }
  });
  tx();

  return db.prepare('SELECT * FROM user_profiles WHERE uid = ?').get(uid);
}

module.exports = { recalcUser, currentYearMonth };
