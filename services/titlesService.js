// ============================================================================
// services/titlesService.js — 타이틀 카탈로그(앱 lib/progression/titles.ts 미러)
// ============================================================================
// 앱의 전체 타이틀 래더(running/shoeManagement/rotation/injuryPrevention/consistency/
// retirement)를 1:1 포팅한다(키·이름·tier·criterion 동일). Rank=progression, Title=identity
// 분리. 검증된 컨텍스트로 criterion 을 직접 판정해 upsert 하고, equip 은 단 하나만 보존한다.
//
// 시간 기반 타이틀(≥6개월 등)은 tenureDays(가장 이른 firstWorn~now)로 게이트한다. mgmt/
// rotation/injury 평가축은 rankService.computeRank 재사용(권위 단일 출처).
// ============================================================================
const { randomUUID } = require('crypto');
const db = require('../models/db');
const { computeRank } = require('./rankService');
const { isSmartOrBetter, isPerfectOrBetter } = require('./gradeService');

const DAY_MS = 86400000;
const MONTH_1 = 30;
const MONTH_3 = 90;
const MONTH_6 = 182;
const YEAR_1 = 365;
const YEAR_2 = 730;
const OVERDUE_RATIO = 0.9;
const WEEKLY_ACTIVE = 0.75;
const WEEKLY_ELITE = 0.9;

function nonNeg(n) {
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function ymdToMs(d) {
  const [y, m, dd] = String(d).split('-').map(Number);
  const ms = Date.UTC(y, (m || 1) - 1, dd || 1);
  return Number.isFinite(ms) ? ms : NaN;
}
function shoeStats(ctx) {
  const map = ctx && ctx.perShoe;
  if (!map || typeof map !== 'object') return [];
  return Object.values(map).filter(Boolean);
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
function shoesUsedCount(ctx) {
  return shoeStats(ctx).filter(s => nonNeg(s.runs) >= 1).length;
}
function shoesUsedConsistentlyCount(ctx) {
  return shoeStats(ctx).filter(s => nonNeg(s.runs) >= 3).length;
}
function wearRatio(s) {
  const max = nonNeg(s.maxKm);
  if (max <= 0) return null;
  return nonNeg(s.km) / max;
}
function allActiveHealthy(ctx) {
  const assessed = shoeStats(ctx).filter(s => !s.retired && nonNeg(s.maxKm) > 0);
  if (assessed.length === 0) return false;
  return assessed.every(s => (wearRatio(s) ?? 1) < OVERDUE_RATIO);
}
function hasEarlyReplacement(ctx) {
  return shoeStats(ctx).some(s => {
    if (!s.retired) return false;
    const r = wearRatio(s);
    return r !== null && r > 0 && r < OVERDUE_RATIO;
  });
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
function mgmtPillar(ctx) {
  return computeRank(ctx).pillars.shoeManagement;
}
function rotationPillar(ctx) {
  return computeRank(ctx).pillars.rotation;
}
function injuryPillar(ctx) {
  return computeRank(ctx).pillars.injuryPrevention;
}

const TITLES = [
  // running
  { key: 'running_beginner', name: '러닝 입문', category: 'running', tier: 'bronze', test: c => nonNeg(c.runCount) >= 1 },
  { key: 'running_100k', name: '100km 클럽', category: 'running', tier: 'silver', test: c => nonNeg(c.cumulativeKm) >= 100 },
  { key: 'running_500k', name: '거리 정복자', category: 'running', tier: 'gold', test: c => nonNeg(c.cumulativeKm) >= 500 },
  { key: 'running_1000k', name: '마라토너의 길', category: 'running', tier: 'platinum', test: c => nonNeg(c.cumulativeKm) >= 1000 },
  { key: 'running_5000k', name: '엘리트 러너', category: 'running', tier: 'diamond', test: c => nonNeg(c.cumulativeKm) >= 5000 },
  { key: 'running_10000k', name: '울트라 러너', category: 'running', tier: 'master', test: c => nonNeg(c.cumulativeKm) >= 10000 },
  { key: 'running_25000k', name: '멈추지 않는 러너', category: 'running', tier: 'legend', test: c => nonNeg(c.cumulativeKm) >= 25000 },
  // shoeManagement
  { key: 'shoe_beginner', name: '신발 입문', category: 'shoeManagement', tier: 'bronze', test: c => nonNeg(c.registeredShoeCount) >= 1 },
  { key: 'shoe_enthusiast', name: '신발 애호가', category: 'shoeManagement', tier: 'silver', test: c => nonNeg(c.registeredShoeCount) >= 3 },
  { key: 'shoe_rotation_runner', name: '로테이션 러너', category: 'shoeManagement', tier: 'gold', test: c => nonNeg(c.registeredShoeCount) >= 5 },
  { key: 'shoe_collector', name: '신발 수집가', category: 'shoeManagement', tier: 'platinum', test: c => nonNeg(c.registeredShoeCount) >= 10 },
  { key: 'shoe_master', name: '신발 마스터', category: 'shoeManagement', tier: 'diamond', test: c => mgmtPillar(c) >= 0.9 && tenureDays(c) >= MONTH_6 },
  { key: 'keego_master', name: 'KEEGO 마스터', category: 'shoeManagement', tier: 'master', test: c => mgmtPillar(c) >= 0.9 && tenureDays(c) >= YEAR_1 },
  { key: 'keep_going', name: 'Keep Going', category: 'shoeManagement', tier: 'legend', test: c => mgmtPillar(c) >= 0.95 && tenureDays(c) >= YEAR_1 },
  // rotation
  { key: 'rotation_starter', name: '로테이션 입문', category: 'rotation', tier: 'bronze', test: c => shoesUsedCount(c) >= 2 },
  { key: 'rotation_balanced', name: '균형 잡힌 러너', category: 'rotation', tier: 'silver', test: c => shoesUsedConsistentlyCount(c) >= 3 },
  { key: 'rotation_expert', name: '로테이션 전문가', category: 'rotation', tier: 'gold', test: c => rotationPillar(c) >= 0.7 && tenureDays(c) >= MONTH_3 },
  { key: 'rotation_architect', name: '로테이션 설계자', category: 'rotation', tier: 'master', test: c => rotationPillar(c) >= 0.8 && tenureDays(c) >= YEAR_2 },
  { key: 'rotation_legend', name: '로테이션 레전드', category: 'rotation', tier: 'legend', test: c => rotationPillar(c) >= 0.9 && tenureDays(c) >= YEAR_2 },
  // injuryPrevention
  { key: 'injury_smart', name: '현명한 러너', category: 'injuryPrevention', tier: 'bronze', test: c => hasEarlyReplacement(c) },
  { key: 'injury_wise', name: '지혜로운 러너', category: 'injuryPrevention', tier: 'silver', test: c => allActiveHealthy(c) },
  { key: 'injury_prevention_expert', name: '예방 전문가', category: 'injuryPrevention', tier: 'gold', test: c => allActiveHealthy(c) && tenureDays(c) >= MONTH_6 },
  { key: 'injury_master', name: '부상 예방 마스터', category: 'injuryPrevention', tier: 'diamond', test: c => injuryPillar(c) >= 0.9 && tenureDays(c) >= YEAR_1 },
  { key: 'injury_iron', name: '철인 러너', category: 'injuryPrevention', tier: 'legend', test: c => injuryPillar(c) >= 0.95 && tenureDays(c) >= YEAR_2 },
  // consistency
  { key: 'consistency_start', name: '꾸준한 시작', category: 'consistency', tier: 'bronze', test: c => nonNeg(c.runCount) >= 4 },
  { key: 'consistency_runner', name: '꾸준한 러너', category: 'consistency', tier: 'silver', test: c => nonNeg(c.weeklyActiveRatio) >= WEEKLY_ACTIVE && tenureDays(c) >= MONTH_1 },
  { key: 'consistency_habit', name: '습관의 완성', category: 'consistency', tier: 'gold', test: c => nonNeg(c.weeklyActiveRatio) >= WEEKLY_ACTIVE && tenureDays(c) >= MONTH_3 },
  { key: 'consistency_monthly', name: '월간 챔피언', category: 'consistency', tier: 'platinum', test: c => nonNeg(c.weeklyActiveRatio) >= WEEKLY_ACTIVE && tenureDays(c) >= MONTH_6 },
  { key: 'consistency_annual', name: '연간 챔피언', category: 'consistency', tier: 'diamond', test: c => nonNeg(c.weeklyActiveRatio) >= WEEKLY_ACTIVE && tenureDays(c) >= YEAR_1 },
  { key: 'consistency_steady', name: '한결같은 러너', category: 'consistency', tier: 'master', test: c => nonNeg(c.weeklyActiveRatio) >= WEEKLY_ACTIVE && tenureDays(c) >= YEAR_2 },
  { key: 'consistency_never_stop', name: '쉼 없는 러너', category: 'consistency', tier: 'legend', test: c => nonNeg(c.weeklyActiveRatio) >= WEEKLY_ELITE && tenureDays(c) >= YEAR_2 },
  // retirement
  { key: 'retire_starter', name: '신발 관리 입문', category: 'retirement', tier: 'bronze', test: c => retirementCount(c) >= 1 },
  { key: 'retire_mindful', name: '사려 깊은 관리자', category: 'retirement', tier: 'silver', test: c => retirementCount(c) >= 3 },
  { key: 'retire_smart', name: '현명한 관리자', category: 'retirement', tier: 'gold', test: c => retirementCount(c) >= 5 && smartOrBetterRetirementCount(c) >= 1 },
  { key: 'retire_curator', name: '큐레이션 프로', category: 'retirement', tier: 'platinum', test: c => retirementCount(c) >= 5 && smartOrBetterRetirementCount(c) >= 3 },
  { key: 'retire_hall', name: '명예의 전당 키퍼', category: 'retirement', tier: 'diamond', test: c => retirementCount(c) >= 10 },
  { key: 'retire_perfect', name: '완벽한 큐레이터', category: 'retirement', tier: 'master', test: c => retirementCount(c) >= 10 && perfectRetirementCount(c) >= 1 },
  { key: 'retire_keep_going', name: 'Keep Going', category: 'retirement', tier: 'legend', test: c => retirementCount(c) >= 10 && perfectRetirementCount(c) >= 3 },
];

function catalog() {
  return TITLES.map(t => ({ key: t.key, name: t.name, category: t.category, tier: t.tier }));
}

/**
 * uid 의 타이틀을 컨텍스트로 재판정해 upsert. 기존 unlocked_at / is_equipped 보존.
 * @returns {{count:number, unlockedKeys:string[]}}
 */
function recalc(uid, ctx) {
  const insert = db.prepare(
    `INSERT INTO titles (id, uid, title_key, category, tier, is_equipped)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(uid, title_key) DO NOTHING`,
  );
  const unlockedKeys = [];
  const tx = db.transaction(() => {
    for (const t of TITLES) {
      let ok = false;
      try {
        ok = t.test(ctx) === true;
      } catch (e) {
        ok = false;
      }
      if (!ok) continue;
      insert.run(randomUUID(), uid, t.key, t.category, t.tier);
      unlockedKeys.push(t.key);
    }
  });
  tx();
  return { count: unlockedKeys.length, unlockedKeys };
}

function listForUser(uid) {
  return db
    .prepare('SELECT title_key, category, tier, is_equipped, unlocked_at FROM titles WHERE uid = ? ORDER BY unlocked_at')
    .all(uid);
}

/** 단 하나만 장착. 보유한 타이틀만 장착 가능(없으면 false). */
function equip(uid, titleKey) {
  const owned = db
    .prepare('SELECT 1 FROM titles WHERE uid = ? AND title_key = ?')
    .get(uid, titleKey);
  if (!owned) return false;
  const tx = db.transaction(() => {
    db.prepare('UPDATE titles SET is_equipped = 0 WHERE uid = ?').run(uid);
    db.prepare('UPDATE titles SET is_equipped = 1 WHERE uid = ? AND title_key = ?').run(uid, titleKey);
    db.prepare("UPDATE user_profiles SET equipped_title = ?, updated_at = datetime('now') WHERE uid = ?").run(
      titleKey,
      uid,
    );
  });
  tx();
  return true;
}

module.exports = { TITLES, catalog, recalc, listForUser, equip };
