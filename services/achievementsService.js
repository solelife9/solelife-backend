// ============================================================================
// services/achievementsService.js — 업적 서버측 재계산(검증된 컨텍스트 기준)
// ============================================================================
// 업적은 클라가 "달성했다"고 우기는 게 아니라, 서버가 ProgressionContext(검증된
// shoes/runs 집계)로 criterion 을 직접 판정한다(날조 금지). 달성된 업적만 테이블에
// upsert 하고, rarity → 포인트 합을 engagement/progressPoints 로 환산한다.
//
// 카탈로그 범위(정직): 앱의 53개 전체 카탈로그를 1:1 복제하진 않았고, distance/runCount/
// consistency/shoeCollection/shoeLife/retirement 를 대표하는 검증 가능한 부분집합을 둔다.
// 구조(판정→upsert→포인트 환산)는 완전하므로 카탈로그 확장은 ACHIEVEMENTS 배열에
// 항목을 추가하는 데이터 작업이다(아키텍처 변경 없음).
// ============================================================================
const { randomUUID } = require('crypto');
const db = require('../models/db');
const { pointsForRarity } = require('./rankService');

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function shoeCount(ctx) {
  return num(ctx.registeredShoeCount);
}
function healthyRetiredCount(ctx) {
  // 합리적 시점(≤1.3배)에 은퇴한 신발 수.
  return Object.values(ctx.perShoe || {}).filter(s => {
    if (!s || !s.retired || num(s.maxKm) <= 0) return false;
    return num(s.km) / num(s.maxKm) <= 1.3;
  }).length;
}

// key 는 앱 카탈로그와 같은 식별자를 쓰도록 의도(동기화 시 충돌 없이 병합).
const ACHIEVEMENTS = [
  { key: 'distance_50', category: 'running', rarity: 'bronze', test: c => num(c.cumulativeKm) >= 50 },
  { key: 'distance_100', category: 'running', rarity: 'bronze', test: c => num(c.cumulativeKm) >= 100 },
  { key: 'distance_500', category: 'running', rarity: 'silver', test: c => num(c.cumulativeKm) >= 500 },
  { key: 'distance_1000', category: 'running', rarity: 'gold', test: c => num(c.cumulativeKm) >= 1000 },
  { key: 'distance_3000', category: 'running', rarity: 'platinum', test: c => num(c.cumulativeKm) >= 3000 },
  { key: 'distance_5000', category: 'running', rarity: 'diamond', test: c => num(c.cumulativeKm) >= 5000 },
  { key: 'longrun_half', category: 'running', rarity: 'silver', test: c => num(c.longestRunKm) >= 21.0975 },
  { key: 'longrun_full', category: 'running', rarity: 'gold', test: c => num(c.longestRunKm) >= 42.195 },
  { key: 'runs_10', category: 'consistency', rarity: 'bronze', test: c => num(c.runCount) >= 10 },
  { key: 'runs_50', category: 'consistency', rarity: 'silver', test: c => num(c.runCount) >= 50 },
  { key: 'runs_100', category: 'consistency', rarity: 'gold', test: c => num(c.runCount) >= 100 },
  { key: 'streak_7', category: 'consistency', rarity: 'bronze', test: c => num(c.longestStreak) >= 7 },
  { key: 'streak_30', category: 'consistency', rarity: 'gold', test: c => num(c.longestStreak) >= 30 },
  { key: 'collection_3', category: 'shoeManagement', rarity: 'bronze', test: c => shoeCount(c) >= 3 },
  { key: 'collection_5', category: 'shoeManagement', rarity: 'silver', test: c => shoeCount(c) >= 5 },
  { key: 'collection_10', category: 'shoeManagement', rarity: 'gold', test: c => shoeCount(c) >= 10 },
  { key: 'rotation_active', category: 'rotation', rarity: 'silver', test: c => {
      const active = Object.values(c.perShoe || {}).filter(s => s && !s.retired && num(s.km) > 0);
      return active.length >= 2;
    } },
  { key: 'first_retirement', category: 'retirement', rarity: 'silver', test: c => num(c.retiredShoeCount) >= 1 },
  { key: 'curator_5', category: 'retirement', rarity: 'gold', test: c => num(c.retiredShoeCount) >= 5 },
  { key: 'smart_replacement', category: 'retirement', rarity: 'gold', test: c => healthyRetiredCount(c) >= 1 },
];

/** 카탈로그 정의(키→메타). 컨트롤러가 진행도/메타 표시에 쓴다. */
function catalog() {
  return ACHIEVEMENTS.map(a => ({ key: a.key, category: a.category, rarity: a.rarity }));
}

/**
 * uid 의 업적을 컨텍스트로 재판정해 upsert 한다. 이미 달성된 건 unlocked_at 보존.
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
        ok = !!a.test(ctx);
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

/** 저장된 업적 목록(표시용). */
function listForUser(uid) {
  return db
    .prepare('SELECT achievement_key, category, rarity, unlocked_at FROM achievements WHERE uid = ? ORDER BY unlocked_at')
    .all(uid);
}

module.exports = { ACHIEVEMENTS, catalog, recalc, listForUser };
