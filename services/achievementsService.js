// ============================================================================
// services/achievementsService.js — 업적 카탈로그(앱 lib/progression/achievements.ts 미러)
// ============================================================================
// 앱의 53개 업적 카탈로그를 **1:1 포팅**한다(키·이름·rarity·target·criterion 동일).
// 서버가 검증된 ProgressionContext 로 unlocked 를 직접 판정해 upsert 한다(날조 금지).
//
// 데이터 한계(정직): run_date 에 시각이 없어 earlyRunCount/nightRunCount=0 →
// 히든 'earlyBird'/'nightRunner' 는 서버에서 언락되지 않는다(앱 로컬 판정만). 그 외는
// 검증 데이터로 산정 가능(거리/횟수/스트릭/주간/신발/로테이션/마모/은퇴등급 등).
// ============================================================================
const { randomUUID } = require('crypto');
const db = require('../models/db');
const { computeRank, pointsForRarity } = require('./rankService');
const { isSmartOrBetter, isPerfectOrBetter } = require('./gradeService');

const DAY_MS = 86400000;
const OVERDUE_RATIO = 0.9;
const HALF_MARATHON_KM = 21.0975;
const MARATHON_KM = 42.195;
const TRUSTED_PARTNER_KM = 500;
const LONG_HAUL_KM = 1000;
const SPEEDSTER_PACE_SEC = 300;

function nonNeg(n) {
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function shoeStats(ctx) {
  const map = ctx && ctx.perShoe;
  if (!map || typeof map !== 'object') return [];
  return Object.values(map).filter(Boolean);
}
function wearRatio(s) {
  const max = nonNeg(s.maxKm);
  if (max <= 0) return null;
  return nonNeg(s.km) / max;
}
function maxSingleShoeKm(ctx) {
  return shoeStats(ctx).reduce((m, s) => Math.max(m, nonNeg(s.km)), 0);
}
function shoesUsedCount(ctx) {
  return shoeStats(ctx).filter(s => nonNeg(s.runs) >= 1).length;
}
function earlyReplacementCount(ctx) {
  return shoeStats(ctx).filter(s => {
    if (!s.retired) return false;
    const r = wearRatio(s);
    return r !== null && r > 0 && r < OVERDUE_RATIO;
  }).length;
}
function healthyActiveCount(ctx) {
  return shoeStats(ctx).filter(
    s => !s.retired && nonNeg(s.maxKm) > 0 && (wearRatio(s) ?? 1) < OVERDUE_RATIO,
  ).length;
}
function assessedActiveCount(ctx) {
  return shoeStats(ctx).filter(s => !s.retired && nonNeg(s.maxKm) > 0).length;
}
function rotationPillar(ctx) {
  return computeRank(ctx).pillars.rotation;
}
function ymdToMs(d) {
  const [y, m, dd] = String(d).split('-').map(Number);
  const ms = Date.UTC(y, (m || 1) - 1, dd || 1);
  return Number.isFinite(ms) ? ms : NaN;
}
function tenureDays(ctx) {
  let earliest = null;
  for (const s of shoeStats(ctx)) {
    if (s.firstWorn && (!earliest || s.firstWorn < earliest)) earliest = s.firstWorn;
  }
  if (!earliest) return 0;
  const ms = ymdToMs(earliest);
  const now = Number.isFinite(ctx.now) ? ctx.now : 0;
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((now - ms) / DAY_MS));
}
function maxActiveShoeAgeDays(ctx) {
  const now = Number.isFinite(ctx.now) ? ctx.now : 0;
  let max = 0;
  for (const s of shoeStats(ctx)) {
    if (s.retired || !s.firstWorn) continue;
    const ms = ymdToMs(s.firstWorn);
    if (!Number.isFinite(ms)) continue;
    const age = Math.max(0, Math.floor((now - ms) / DAY_MS));
    if (age > max) max = age;
  }
  return max;
}
function balancedRotationTenureDays(ctx) {
  return rotationPillar(ctx) >= 0.7 ? tenureDays(ctx) : 0;
}
function retirementCount(ctx) {
  return nonNeg(ctx && ctx.retirementCount ? ctx.retirementCount : 0);
}
function retirementGrades(ctx) {
  const g = ctx && ctx.retirementGrades;
  return Array.isArray(g) ? g.filter(Boolean) : [];
}
function smartOrBetterRetirementCount(ctx) {
  return retirementGrades(ctx).filter(isSmartOrBetter).length;
}
function perfectRetirementCount(ctx) {
  return retirementGrades(ctx).filter(isPerfectOrBetter).length;
}
function isSpeedster(ctx) {
  const p = ctx && ctx.bestPace5kSec;
  return typeof p === 'number' && p > 0 && p <= SPEEDSTER_PACE_SEC;
}

// 단조 증가 지표 업적: unlocked ⟺ value ≥ target.
function metricAch(o) {
  return {
    key: o.key, name: o.name, category: o.category, group: o.group,
    rarity: o.rarity, hidden: !!o.hidden, target: o.target,
    value: o.value,
    unlocked: ctx => nonNeg(o.value(ctx)) >= o.target,
  };
}

const ACHIEVEMENTS = [
  // First Milestones
  metricAch({ key: 'ach_first_run', name: '첫 걸음', category: 'running', group: 'firstMilestone', rarity: 'bronze', target: 1, value: c => nonNeg(c.runCount) }),
  metricAch({ key: 'ach_first_5k', name: '첫 5km', category: 'running', group: 'firstMilestone', rarity: 'bronze', target: 5, value: c => nonNeg(c.longestRunKm) }),
  metricAch({ key: 'ach_first_10k', name: '첫 10km', category: 'running', group: 'firstMilestone', rarity: 'bronze', target: 10, value: c => nonNeg(c.longestRunKm) }),
  metricAch({ key: 'ach_half_marathon', name: '하프 마라톤', category: 'running', group: 'firstMilestone', rarity: 'silver', target: HALF_MARATHON_KM, value: c => nonNeg(c.longestRunKm) }),
  metricAch({ key: 'ach_marathon', name: '마라톤 완주', category: 'running', group: 'firstMilestone', rarity: 'gold', target: MARATHON_KM, value: c => nonNeg(c.longestRunKm) }),
  { key: 'ach_speedster', name: '스피드스터', category: 'running', group: 'firstMilestone', rarity: 'gold', target: 1, value: c => (isSpeedster(c) ? 1 : 0), unlocked: isSpeedster },
  // Distance
  metricAch({ key: 'ach_dist_50', name: '50km', category: 'running', group: 'distance', rarity: 'bronze', target: 50, value: c => nonNeg(c.cumulativeKm) }),
  metricAch({ key: 'ach_dist_100', name: '100km', category: 'running', group: 'distance', rarity: 'bronze', target: 100, value: c => nonNeg(c.cumulativeKm) }),
  metricAch({ key: 'ach_dist_250', name: '250km', category: 'running', group: 'distance', rarity: 'silver', target: 250, value: c => nonNeg(c.cumulativeKm) }),
  metricAch({ key: 'ach_dist_500', name: '500km', category: 'running', group: 'distance', rarity: 'silver', target: 500, value: c => nonNeg(c.cumulativeKm) }),
  metricAch({ key: 'ach_distance_1000', name: '1,000km', category: 'running', group: 'distance', rarity: 'gold', target: 1000, value: c => nonNeg(c.cumulativeKm) }),
  metricAch({ key: 'ach_dist_2500', name: '2,500km', category: 'running', group: 'distance', rarity: 'platinum', target: 2500, value: c => nonNeg(c.cumulativeKm) }),
  metricAch({ key: 'ach_distance_5000', name: '5,000km', category: 'running', group: 'distance', rarity: 'diamond', target: 5000, value: c => nonNeg(c.cumulativeKm) }),
  metricAch({ key: 'ach_dist_10000', name: '10,000km', category: 'running', group: 'distance', rarity: 'master', target: 10000, value: c => nonNeg(c.cumulativeKm) }),
  // Run Count
  metricAch({ key: 'ach_runs_10', name: '10회 러닝', category: 'consistency', group: 'runCount', rarity: 'bronze', target: 10, value: c => nonNeg(c.runCount) }),
  metricAch({ key: 'ach_runs_25', name: '25회 러닝', category: 'consistency', group: 'runCount', rarity: 'bronze', target: 25, value: c => nonNeg(c.runCount) }),
  metricAch({ key: 'ach_runs_50', name: '50회 러닝', category: 'consistency', group: 'runCount', rarity: 'silver', target: 50, value: c => nonNeg(c.runCount) }),
  metricAch({ key: 'ach_century_runs', name: '100회 러닝', category: 'consistency', group: 'runCount', rarity: 'gold', target: 100, value: c => nonNeg(c.runCount) }),
  metricAch({ key: 'ach_runs_250', name: '250회 러닝', category: 'consistency', group: 'runCount', rarity: 'platinum', target: 250, value: c => nonNeg(c.runCount) }),
  metricAch({ key: 'ach_runs_500', name: '500회 러닝', category: 'consistency', group: 'runCount', rarity: 'diamond', target: 500, value: c => nonNeg(c.runCount) }),
  metricAch({ key: 'ach_runs_1000', name: '1,000회 러닝', category: 'consistency', group: 'runCount', rarity: 'master', target: 1000, value: c => nonNeg(c.runCount) }),
  // Consistency
  metricAch({ key: 'ach_streak_7', name: '일주일 전사', category: 'consistency', group: 'consistency', rarity: 'silver', target: 7, value: c => nonNeg(c.longestStreak) }),
  metricAch({ key: 'ach_streak_14', name: '2주의 약속', category: 'consistency', group: 'consistency', rarity: 'silver', target: 14, value: c => nonNeg(c.longestStreak) }),
  metricAch({ key: 'ach_streak_30', name: '무적의 한 달', category: 'consistency', group: 'consistency', rarity: 'gold', target: 30, value: c => nonNeg(c.longestStreak) }),
  metricAch({ key: 'ach_streak_100', name: '100일의 기적', category: 'consistency', group: 'consistency', rarity: 'diamond', target: 100, value: c => nonNeg(c.longestStreak) }),
  metricAch({ key: 'ach_streak_365', name: '365일의 여정', category: 'consistency', group: 'consistency', rarity: 'master', target: 365, value: c => nonNeg(c.longestStreak) }),
  metricAch({ key: 'ach_weekly_habit', name: '습관 형성', category: 'consistency', group: 'consistency', rarity: 'silver', target: 75, value: c => Math.round(nonNeg(c.weeklyActiveRatio) * 100) }),
  // Shoe Collection
  metricAch({ key: 'ach_shoe_1', name: '첫 신발', category: 'shoeManagement', group: 'shoeCollection', rarity: 'bronze', target: 1, value: c => nonNeg(c.registeredShoeCount) }),
  metricAch({ key: 'ach_shoe_3', name: '3켤레 컬렉션', category: 'shoeManagement', group: 'shoeCollection', rarity: 'bronze', target: 3, value: c => nonNeg(c.registeredShoeCount) }),
  metricAch({ key: 'ach_collection_5', name: '신발 큐레이터', category: 'shoeManagement', group: 'shoeCollection', rarity: 'silver', target: 5, value: c => nonNeg(c.registeredShoeCount) }),
  metricAch({ key: 'ach_collection_10', name: '신발 감식가', category: 'shoeManagement', group: 'shoeCollection', rarity: 'gold', target: 10, value: c => nonNeg(c.registeredShoeCount) }),
  // Shoe Life
  metricAch({ key: 'ach_trusted_partner', name: '믿음직한 파트너', category: 'shoeManagement', group: 'shoeLife', rarity: 'gold', target: TRUSTED_PARTNER_KM, value: maxSingleShoeKm }),
  metricAch({ key: 'ach_long_haul', name: '천 킬로의 동반자', category: 'shoeManagement', group: 'shoeLife', rarity: 'diamond', target: LONG_HAUL_KM, value: maxSingleShoeKm }),
  // Rotation
  metricAch({ key: 'ach_rotation_2', name: '2켤레 로테이션', category: 'rotation', group: 'rotation', rarity: 'bronze', target: 2, value: shoesUsedCount }),
  metricAch({ key: 'ach_rotation_3', name: '세 켤레의 동행', category: 'rotation', group: 'rotation', rarity: 'silver', target: 3, value: shoesUsedCount }),
  metricAch({ key: 'ach_rotation_5', name: '로테이션 마에스트로', category: 'rotation', group: 'rotation', rarity: 'gold', target: 5, value: shoesUsedCount }),
  metricAch({ key: 'ach_rotation_balance', name: '완벽한 균형', category: 'rotation', group: 'rotation', rarity: 'platinum', target: 80, value: c => Math.round(rotationPillar(c) * 100) }),
  metricAch({ key: 'ach_rotation_6mo', name: '6개월 로테이션', category: 'rotation', group: 'rotation', rarity: 'gold', target: 182, value: balancedRotationTenureDays }),
  metricAch({ key: 'ach_rotation_1yr', name: '1년 로테이션', category: 'rotation', group: 'rotation', rarity: 'platinum', target: 365, value: balancedRotationTenureDays }),
  // Injury Prevention
  metricAch({ key: 'ach_smart_swap', name: '현명한 교체', category: 'injuryPrevention', group: 'injuryPrevention', rarity: 'silver', target: 1, value: earlyReplacementCount }),
  metricAch({ key: 'ach_health_guardian', name: '건강 지킴이', category: 'injuryPrevention', group: 'injuryPrevention', rarity: 'gold', target: 3, value: earlyReplacementCount }),
  {
    key: 'ach_clean_rotation', name: '건강한 로테이션', category: 'injuryPrevention',
    group: 'injuryPrevention', rarity: 'silver', target: 2,
    value: c => healthyActiveCount(c),
    unlocked: c => {
      const assessed = assessedActiveCount(c);
      return assessed >= 2 && healthyActiveCount(c) === assessed;
    },
  },
  metricAch({ key: 'ach_smart_replacement', name: '좋은 타이밍', category: 'injuryPrevention', group: 'injuryPrevention', rarity: 'silver', target: 1, value: smartOrBetterRetirementCount }),
  metricAch({ key: 'ach_perfect_timing', name: '완벽한 타이밍', category: 'injuryPrevention', group: 'injuryPrevention', rarity: 'gold', target: 1, value: perfectRetirementCount }),
  // Retirement
  metricAch({ key: 'ach_first_retirement', name: '첫 은퇴', category: 'retirement', group: 'retirement', rarity: 'bronze', target: 1, value: retirementCount }),
  metricAch({ key: 'ach_retire_3', name: '3켤레 은퇴', category: 'retirement', group: 'retirement', rarity: 'silver', target: 3, value: retirementCount }),
  metricAch({ key: 'ach_retire_5', name: '5켤레 은퇴', category: 'retirement', group: 'retirement', rarity: 'silver', target: 5, value: retirementCount }),
  metricAch({ key: 'ach_retire_10', name: '명예의 전당', category: 'retirement', group: 'retirement', rarity: 'gold', target: 10, value: retirementCount }),
  // Hidden (earlyBird/nightRunner 는 서버 데이터 부족으로 사실상 미언락)
  metricAch({ key: 'ach_hidden_early_bird', name: '얼리버드', category: 'running', group: 'hidden', rarity: 'gold', target: 20, hidden: true, value: c => nonNeg(c.earlyRunCount) }),
  metricAch({ key: 'ach_hidden_night_runner', name: '나이트 러너', category: 'running', group: 'hidden', rarity: 'gold', target: 20, hidden: true, value: c => nonNeg(c.nightRunCount) }),
  metricAch({ key: 'ach_hidden_comeback', name: '컴백 러너', category: 'consistency', group: 'hidden', rarity: 'silver', target: 30, hidden: true, value: c => nonNeg(c.longestGapDays) }),
  metricAch({ key: 'ach_hidden_long_relationship', name: '오랜 동반자', category: 'shoeManagement', group: 'hidden', rarity: 'platinum', target: 365, hidden: true, value: maxActiveShoeAgeDays }),
];

/** 카탈로그 메타(표시/진행도용). */
function catalog() {
  return ACHIEVEMENTS.map(a => ({
    key: a.key, name: a.name, category: a.category, group: a.group,
    rarity: a.rarity, hidden: !!a.hidden, target: a.target,
  }));
}

/**
 * uid 의 업적을 컨텍스트로 재판정해 upsert. 이미 달성된 건 unlocked_at 보존.
 * @returns {{count:number, points:number, unlockedKeys:string[]}}
 */
function recalc(uid, ctx) {
  const insert = db.prepare(
    `INSERT INTO achievements (id, uid, achievement_key, category, rarity)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(uid, achievement_key) DO NOTHING`,
  );
  const unlockedKeys = [];
  let points = 0;
  const tx = db.transaction(() => {
    for (const a of ACHIEVEMENTS) {
      let ok = false;
      try {
        ok = a.unlocked(ctx) === true;
      } catch (e) {
        ok = false;
      }
      if (!ok) continue;
      insert.run(randomUUID(), uid, a.key, a.category, a.rarity);
      unlockedKeys.push(a.key);
      points += pointsForRarity(a.rarity);
    }
  });
  tx();
  return { count: unlockedKeys.length, points, unlockedKeys };
}

function listForUser(uid) {
  return db
    .prepare('SELECT achievement_key, category, rarity, unlocked_at FROM achievements WHERE uid = ? ORDER BY unlocked_at')
    .all(uid);
}

module.exports = { ACHIEVEMENTS, catalog, recalc, listForUser };
