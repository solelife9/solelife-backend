// ============================================================================
// services/rankService.js — 합성 랭크 엔진(앱 lib/progression/rank.ts 의 서버 미러)
// ============================================================================
// 클라가 보낸 점수를 신뢰하지 않고, 서버가 검증된 데이터로 만든 ProgressionContext 에서
// 동일한 공식으로 랭크를 재계산한다. 앱과 **수치가 일치**해야 리더보드가 공정하므로,
// 가중치/포화 기준/티어 컷오프/색상/포인트 매핑을 앱과 1:1 로 복제한다(단일 출처 동기화).
//
//   score = 100 × ( 0.25·running + 0.20·consistency + 0.20·shoeManagement
//                 + 0.15·rotation + 0.10·injuryPrevention + 0.10·engagement )
//
// PURE: 입력 불변, NaN/음수/누락 → 0, throw 금지.
// ============================================================================

// 티어 색 — 앱 theme.ts TIER_COLORS 와 동일(steer R3 권위). 색이 이름보다 기억돼야 함.
const TIER_COLORS = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFD700',
  platinum: '#14B8A6',
  diamond: '#3B82F6',
  master: '#9333EA',
  legend: '#FF6500',
};

// 평가축 가중치(합 1.0, spec 권위).
const WEIGHTS = {
  running: 0.25,
  consistency: 0.2,
  shoeManagement: 0.2,
  rotation: 0.15,
  injuryPrevention: 0.1,
  engagement: 0.1,
};

// 티어 컷오프(점수 하한, 높은 티어부터). 첫 매칭이 그 티어.
const TIER_CUTOFFS = [
  [97, 'legend'],
  [90, 'master'],
  [78, 'diamond'],
  [62, 'platinum'],
  [45, 'gold'],
  [25, 'silver'],
  [0, 'bronze'],
];

// 희귀도(rarity)별 진척 포인트 — 앱 points.ts 와 동일.
const POINTS_BY_RARITY = {
  bronze: 10,
  silver: 25,
  gold: 50,
  platinum: 100,
  diamond: 250,
  master: 500,
  legend: 1000,
};

const OVERDUE_RATIO = 0.9; // lib/shoe.SHOE_REPLACE_PCT(90%) 과 동일.
const CUMULATIVE_SATURATION_KM = 8000;
const SINGLE_SATURATION_KM = 42.195;
const STREAK_SATURATION_DAYS = 30;
const CURRENT_STREAK_SATURATION_DAYS = 14;
const ENGAGEMENT_CAP = 24;
const ACH_POINTS_SATURATION = 1200;
const LATE_RETIRE_RATIO = 1.3;

// ── 수치 방어 헬퍼 ────────────────────────────────────────────────────────────
function nonNeg(n) {
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function clamp01(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1 ? 1 : n;
}
function clampScore(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 100 ? 100 : n;
}
function logSaturate(value, scale) {
  const v = nonNeg(value);
  const s = nonNeg(scale);
  if (s <= 0) return 0;
  return clamp01(Math.log1p(v) / Math.log1p(s));
}
function isOverdue(s) {
  const km = nonNeg(s.km);
  const max = nonNeg(s.maxKm);
  return max > 0 && km / max >= OVERDUE_RATIO;
}

// ── 평가축(각 0..1) ───────────────────────────────────────────────────────────
function runningPillar(ctx) {
  const cumulative = logSaturate(ctx.cumulativeKm, CUMULATIVE_SATURATION_KM);
  const single = logSaturate(ctx.longestRunKm, SINGLE_SATURATION_KM);
  return clamp01(0.82 * cumulative + 0.18 * single);
}
function consistencyPillar(ctx) {
  const weekly = clamp01(ctx.weeklyActiveRatio);
  const longest = clamp01(nonNeg(ctx.longestStreak) / STREAK_SATURATION_DAYS);
  const current = clamp01(nonNeg(ctx.currentStreak) / CURRENT_STREAK_SATURATION_DAYS);
  return clamp01(0.45 * weekly + 0.35 * longest + 0.2 * current);
}
function shoeManagementPillar(ctx) {
  const assessed = Object.values(ctx.perShoe || {}).filter(
    s => s && !s.retired && nonNeg(s.maxKm) > 0,
  );
  if (assessed.length === 0) return 0;
  const healthy = assessed.filter(s => !isOverdue(s)).length;
  return clamp01(healthy / assessed.length);
}
function rotationPillar(ctx) {
  const active = Object.values(ctx.perShoe || {}).filter(
    s => s && !s.retired && nonNeg(s.km) > 0,
  );
  const n = active.length;
  if (n < 2) return 0;
  const total = active.reduce((a, s) => a + nonNeg(s.km), 0);
  if (total <= 0) return 0;
  let entropy = 0;
  for (const s of active) {
    const p = nonNeg(s.km) / total;
    if (p > 0) entropy -= p * Math.log(p);
  }
  return clamp01(entropy / Math.log(n));
}
function injuryPreventionPillar(ctx) {
  const shoes = Object.values(ctx.perShoe || {}).filter(s => s && nonNeg(s.maxKm) > 0);
  if (shoes.length === 0) return 0;
  let good = 0;
  let bad = 0;
  for (const s of shoes) {
    const ratio = nonNeg(s.km) / nonNeg(s.maxKm);
    if (s.retired) {
      if (ratio <= LATE_RETIRE_RATIO) {
        good += 1;
      } else {
        good += 0.5;
        bad += 0.5;
      }
    } else if (ratio >= OVERDUE_RATIO) {
      bad += 1;
    } else {
      good += 1;
    }
  }
  const denom = good + bad;
  return denom > 0 ? clamp01(good / denom) : 0;
}
function engagementPillar(ctx) {
  const titles = nonNeg(ctx.earnedTitleCount);
  const challenges = nonNeg(ctx.completedChallengeCount);
  const activity = (titles + challenges) / ENGAGEMENT_CAP;
  const achievements = nonNeg(ctx.achievementPoints || 0) / ACH_POINTS_SATURATION;
  return clamp01(activity + achievements);
}

function computePillars(ctx) {
  return {
    running: runningPillar(ctx),
    consistency: consistencyPillar(ctx),
    shoeManagement: shoeManagementPillar(ctx),
    rotation: rotationPillar(ctx),
    injuryPrevention: injuryPreventionPillar(ctx),
    engagement: engagementPillar(ctx),
  };
}
function scoreFromPillars(p) {
  const raw =
    100 *
    (WEIGHTS.running * p.running +
      WEIGHTS.consistency * p.consistency +
      WEIGHTS.shoeManagement * p.shoeManagement +
      WEIGHTS.rotation * p.rotation +
      WEIGHTS.injuryPrevention * p.injuryPrevention +
      WEIGHTS.engagement * p.engagement);
  return clampScore(raw);
}

// ── 공개 API ──────────────────────────────────────────────────────────────────
function tierForScore(score) {
  const s = clampScore(score);
  for (const [cut, tier] of TIER_CUTOFFS) {
    if (s >= cut) return tier;
  }
  return 'bronze';
}
function colorForTier(tier) {
  return TIER_COLORS[tier] || TIER_COLORS.bronze;
}
function pointsForRarity(tier) {
  const p = POINTS_BY_RARITY[tier];
  return Number.isFinite(p) ? p : 0;
}

/** 빈/비정상 컨텍스트 → score 0, Bronze, 평가축 0. */
function computeRank(ctx) {
  if (!ctx || typeof ctx !== 'object') {
    return {
      score: 0,
      tier: 'bronze',
      color: TIER_COLORS.bronze,
      pillars: {
        running: 0,
        consistency: 0,
        shoeManagement: 0,
        rotation: 0,
        injuryPrevention: 0,
        engagement: 0,
      },
    };
  }
  const pillars = computePillars(ctx);
  const score = scoreFromPillars(pillars);
  const tier = tierForScore(score);
  return { score, tier, color: TIER_COLORS[tier], pillars };
}

module.exports = {
  TIER_COLORS,
  WEIGHTS,
  TIER_CUTOFFS,
  POINTS_BY_RARITY,
  computeRank,
  tierForScore,
  colorForTier,
  pointsForRarity,
};
