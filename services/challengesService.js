// ============================================================================
// services/challengesService.js — 월간 챌린지 진행도 서버측 재계산
// ============================================================================
// 해당 yearMonth 의 월간 집계(거리/활동일/신발수)로 챌린지 progress/target 을 산정하고
// upsert 한다. completed 는 서버 판정(클라 불신). engagement 평가축의 completedChallengeCount
// 입력이 된다.
//
// 카탈로그 범위(정직): 대표 월간 챌린지(거리/일관성/로테이션)만 둔다 — 개인화(Smart/Shoe)
// 챌린지는 CHALLENGES 데이터/판정 추가로 확장.
// ============================================================================
const { randomUUID } = require('crypto');
const db = require('../models/db');

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

// monthly = { distanceKm, runCount, activeDays, shoesUsedCount }
const CHALLENGES = [
  { key: 'monthly_distance_50', target: 50, value: m => num(m.distanceKm) },
  { key: 'monthly_distance_100', target: 100, value: m => num(m.distanceKm) },
  { key: 'monthly_runs_12', target: 12, value: m => num(m.runCount) },
  { key: 'monthly_active_15', target: 15, value: m => num(m.activeDays) },
  { key: 'monthly_rotation_2', target: 2, value: m => num(m.shoesUsedCount) },
];

function catalog() {
  return CHALLENGES.map(c => ({ key: c.key, target: c.target }));
}

/**
 * 특정 월의 챌린지 진행도를 upsert. monthly 집계가 없으면 0 진행으로 둔다.
 * @returns {{completedCount:number}}
 */
function recalc(uid, yearMonth, monthly) {
  const m = monthly || { distanceKm: 0, runCount: 0, activeDays: 0, shoesUsedCount: 0 };
  const upsert = db.prepare(
    `INSERT INTO challenge_progress (id, uid, challenge_key, year_month, progress, target, completed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(uid, challenge_key, year_month)
     DO UPDATE SET progress = excluded.progress, target = excluded.target,
       completed = excluded.completed, updated_at = datetime('now')`,
  );
  let completedCount = 0;
  const tx = db.transaction(() => {
    for (const c of CHALLENGES) {
      const progress = c.value(m);
      const completed = progress >= c.target ? 1 : 0;
      if (completed) completedCount += 1;
      upsert.run(randomUUID(), uid, c.key, yearMonth, progress, c.target, completed);
    }
  });
  tx();
  return { completedCount };
}

/** 사용자가 완료한(전체 기간) 챌린지 수 — engagement 입력. */
function completedTotal(uid) {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM challenge_progress WHERE uid = ? AND completed = 1')
    .get(uid);
  return row ? num(row.n) : 0;
}

function listForUser(uid, yearMonth) {
  if (yearMonth) {
    return db
      .prepare('SELECT challenge_key, year_month, progress, target, completed FROM challenge_progress WHERE uid = ? AND year_month = ?')
      .all(uid, yearMonth);
  }
  return db
    .prepare('SELECT challenge_key, year_month, progress, target, completed FROM challenge_progress WHERE uid = ? ORDER BY year_month DESC')
    .all(uid);
}

module.exports = { CHALLENGES, catalog, recalc, completedTotal, listForUser };
