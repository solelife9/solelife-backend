// ============================================================================
// services/titlesService.js — 타이틀(identity) 서버측 재계산
// ============================================================================
// Rank=progression, Title=identity 분리(steer R3). 타이틀은 검증된 컨텍스트에서
// criterion 으로 판정해 upsert 한다. 사용자는 多 수집하되 단 하나만 equip(is_equipped=1).
// equip 상태는 재계산이 보존한다(달성 판정만 갱신, 장착 선택은 사용자 몫).
//
// 카탈로그 범위(정직): 대표 사다리(running/consistency/shoeManagement)만 둔다 — 구조는
// 완전하므로 카테고리/티어 확장은 TITLES 데이터 추가다.
// ============================================================================
const { randomUUID } = require('crypto');
const db = require('../models/db');

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

const TITLES = [
  // Running 사다리
  { key: 'runner_rising', name: 'Rising Runner', category: 'running', tier: 'bronze', test: c => num(c.cumulativeKm) >= 100 },
  { key: 'runner_devoted', name: 'Devoted Runner', category: 'running', tier: 'silver', test: c => num(c.cumulativeKm) >= 500 },
  { key: 'runner_elite', name: 'Elite Runner', category: 'running', tier: 'gold', test: c => num(c.cumulativeKm) >= 1000 },
  { key: 'runner_legend', name: 'Distance Legend', category: 'running', tier: 'diamond', test: c => num(c.cumulativeKm) >= 5000 },
  // Consistency 사다리
  { key: 'consistent_starter', name: 'Steady Starter', category: 'consistency', tier: 'bronze', test: c => num(c.longestStreak) >= 7 },
  { key: 'consistent_keeper', name: 'Streak Keeper', category: 'consistency', tier: 'gold', test: c => num(c.longestStreak) >= 30 },
  // Shoe Management 사다리
  { key: 'shoe_curator', name: 'Shoe Curator', category: 'shoeManagement', tier: 'silver', test: c => num(c.registeredShoeCount) >= 5 },
  { key: 'shoe_master', name: 'Shoe Master', category: 'shoeManagement', tier: 'gold', test: c => num(c.registeredShoeCount) >= 10 },
  // Injury Prevention
  { key: 'keep_going', name: 'Keep Going', category: 'injuryPrevention', tier: 'platinum', test: c => num(c.retiredShoeCount) >= 3 },
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
        ok = !!t.test(ctx);
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
