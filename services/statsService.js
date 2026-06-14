// ============================================================================
// services/statsService.js — 검증된 DB 데이터 → ProgressionContext / 월간 통계
// ============================================================================
// Firebase UID → (firebase_uid 로 연결된) 로컬 user 들의 shoes/runs 를 읽어 앱
// lib/progression/context.buildContext 와 동형의 ProgressionContext 를 만든다.
// 클라가 제출한 점수는 쓰지 않는다 — 서버가 보유한 행만이 진실.
//
// 시간대 한계(정직): runs.run_date 는 'YYYY-MM-DD'(시각 없음)라 earlyRunCount/
// nightRunCount 는 산정 불가 → 0(방어적 누락). 은퇴 영속 레코드도 이 DB 엔 없어
// retirementCount=0, retirementGrades=[].
// ============================================================================
const db = require('../models/db');

const DAY_MS = 24 * 60 * 60 * 1000;

/** uid 로 연결된 로컬 user.id 목록(없으면 빈 배열 → 빈 컨텍스트). */
function localUserIds(uid) {
  if (!uid) return [];
  return db
    .prepare('SELECT id FROM users WHERE firebase_uid = ?')
    .all(uid)
    .map(r => r.id);
}

/** 연결된 모든 로컬 계정의 shoes/runs 를 모은다. */
function gatherData(uid) {
  const ids = localUserIds(uid);
  if (ids.length === 0) return { shoes: [], runs: [] };
  const placeholders = ids.map(() => '?').join(',');
  const shoes = db
    .prepare(`SELECT * FROM shoes WHERE user_id IN (${placeholders})`)
    .all(...ids);
  const runs = db
    .prepare(`SELECT * FROM runs WHERE user_id IN (${placeholders})`)
    .all(...ids);
  return { shoes, runs };
}

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** 'YYYY-MM-DD' → epoch day(자정 기준 정수). 비정상 → null. */
function toDayIndex(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const t = Date.parse(dateStr.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  return Math.floor(t / DAY_MS);
}

/** 연속 일수 스트릭(역대 최장 + 마지막 런에서 이어지는 현재). */
function computeStreaks(runDates) {
  const days = [...new Set(runDates.map(toDayIndex).filter(d => d !== null))].sort(
    (a, b) => a - b,
  );
  if (days.length === 0) {
    return { currentStreak: 0, longestStreak: 0, longestGapDays: 0 };
  }
  let longest = 1;
  let run = 1;
  let longestGap = 0;
  for (let i = 1; i < days.length; i++) {
    const gap = days[i] - days[i - 1];
    if (gap === 1) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      if (gap - 1 > longestGap) longestGap = gap - 1;
      run = 1;
    }
  }
  // 현재 스트릭: 마지막 런 날짜에서 거꾸로 연속한 길이.
  let current = 1;
  for (let i = days.length - 1; i > 0; i--) {
    if (days[i] - days[i - 1] === 1) current += 1;
    else break;
  }
  return { currentStreak: current, longestStreak: longest, longestGapDays: longestGap };
}

/** 첫 런 이후 주(7일 버킷) 중 런이 있었던 주의 비율(0..1). */
function computeWeeklyActiveRatio(runDates, now) {
  const days = runDates.map(toDayIndex).filter(d => d !== null);
  if (days.length === 0) return 0;
  const first = Math.min(...days);
  const nowDay = Math.floor(now / DAY_MS);
  const totalWeeks = Math.max(1, Math.floor((nowDay - first) / 7) + 1);
  const activeWeeks = new Set(days.map(d => Math.floor((d - first) / 7))).size;
  return Math.min(1, activeWeeks / totalWeeks);
}

/**
 * 검증된 DB 데이터로 ProgressionContext 를 만든다(앱 buildContext 동형).
 * engagement 입력(earnedTitleCount/completedChallengeCount/achievementPoints)은
 * 호출자(recalcService)가 업적/타이틀/챌린지 재계산 후 주입한다 — 기본 0.
 */
function buildContext(uid, now = Date.now()) {
  const { shoes, runs } = gatherData(uid);

  let cumulativeKm = 0;
  let totalDurationS = 0;
  let longestRunKm = 0;
  const perShoe = {};
  const runDates = [];
  const usedShoeIds = new Set();

  for (const s of shoes) {
    perShoe[s.id] = {
      km: num(s.start_km),
      maxKm: num(s.max_km),
      retired: !!s.retired,
    };
  }

  for (const r of runs) {
    const km = num(r.km);
    cumulativeKm += km;
    totalDurationS += num(r.duration);
    if (km > longestRunKm) longestRunKm = km;
    runDates.push(r.run_date);
    if (r.shoe_id) {
      usedShoeIds.add(r.shoe_id);
      if (!perShoe[r.shoe_id]) {
        perShoe[r.shoe_id] = { km: 0, maxKm: 0, retired: false };
      }
      perShoe[r.shoe_id].km += km;
    }
  }

  const runCount = runs.length;
  const { currentStreak, longestStreak, longestGapDays } = computeStreaks(runDates);
  const weeklyActiveRatio = computeWeeklyActiveRatio(runDates, now);
  const avgPaceSec =
    cumulativeKm > 0 && totalDurationS > 0 ? totalDurationS / cumulativeKm : null;
  const retiredShoeCount = shoes.filter(s => !!s.retired).length;

  return {
    now,
    cumulativeKm,
    runCount,
    totalDurationS,
    longestRunKm,
    bestPaceSec: null,
    bestPace5kSec: null,
    avgPaceSec,
    currentStreak,
    longestStreak,
    weeklyActiveRatio,
    earlyRunCount: 0, // run_date 에 시각 없음 → 산정 불가.
    nightRunCount: 0,
    longestGapDays,
    registeredShoeCount: shoes.length,
    retiredShoeCount,
    retirementCount: 0, // 은퇴 영속 레코드 미보유.
    retirementGrades: [],
    perShoe,
    earnedTitleKeys: [],
    earnedTitleCount: 0,
    completedChallengeCount: 0,
    achievementPoints: 0,
    _shoesUsedCount: usedShoeIds.size, // 월간 통계 보조(컨텍스트 외 메타).
  };
}

/** runs 를 yearMonth('YYYY-MM') 로 묶어 월간 통계 행을 만든다. */
function monthlyAggregates(uid) {
  const { runs } = gatherData(uid);
  const byMonth = {};
  for (const r of runs) {
    const ym = (r.run_date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    if (!byMonth[ym]) {
      byMonth[ym] = { distanceKm: 0, runCount: 0, days: new Set(), shoes: new Set() };
    }
    const m = byMonth[ym];
    m.distanceKm += num(r.km);
    m.runCount += 1;
    m.days.add((r.run_date || '').slice(0, 10));
    if (r.shoe_id) m.shoes.add(r.shoe_id);
  }
  return byMonth;
}

module.exports = {
  buildContext,
  monthlyAggregates,
  localUserIds,
  toDayIndex,
};
