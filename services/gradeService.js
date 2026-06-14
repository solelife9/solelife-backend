// ============================================================================
// services/gradeService.js — Smart Retirement Grade(앱 retirementGrade.ts 미러)
// ============================================================================
// closeness c = usedKm / recommendedKm 로 교체 타이밍 품질을 등급화한다.
//   · perfect: |c-1| ≤ 0.05   · smart: |c-1| ≤ 0.10(perfect 제외)
//   · good: 0.70 ≤ c < 0.90    · standard: 그 외
// hallOfFame 은 PB 하이라이트가 필요해 서버 데이터로는 산정 불가 → smart/perfect 까지만.
// ============================================================================
const PERFECT_BAND = 0.05;
const SMART_BAND = 0.1;
const GOOD_LOWER_RATIO = 0.7;
const BAND_EPS = 1e-9;

const GRADE_QUALITY = { standard: 0, good: 1, smart: 2, perfect: 3, hallOfFame: 4 };

function isSmartOrBetter(grade) {
  const q = grade ? GRADE_QUALITY[grade] : undefined;
  return Number.isFinite(q) && q >= GRADE_QUALITY.smart;
}
function isPerfectOrBetter(grade) {
  const q = grade ? GRADE_QUALITY[grade] : undefined;
  return Number.isFinite(q) && q >= GRADE_QUALITY.perfect;
}

function nonNeg(n) {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** closeness → 기본 등급(hallOfFame 미적용). recommendedKm ≤ 0 → 'standard'. */
function gradeFor(usedKm, recommendedKm) {
  const rec = nonNeg(recommendedKm);
  if (rec <= 0) return 'standard';
  const c = nonNeg(usedKm) / rec;
  const delta = Math.abs(c - 1);
  if (delta <= PERFECT_BAND + BAND_EPS) return 'perfect';
  if (delta <= SMART_BAND + BAND_EPS) return 'smart';
  if (c >= GOOD_LOWER_RATIO - BAND_EPS && c < 1 - SMART_BAND) return 'good';
  return 'standard';
}

module.exports = { gradeFor, isSmartOrBetter, isPerfectOrBetter, GRADE_QUALITY };
