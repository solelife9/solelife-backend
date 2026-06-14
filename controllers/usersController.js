// ============================================================================
// controllers/usersController.js — 프로필 + 식별자 링크
// ============================================================================
// 본인(req.uid)만 읽고 수정한다. 클라가 보낸 uid 바디는 무시(req.uid 만 신뢰).
// ============================================================================
const db = require('../models/db');
const { asyncHandler, httpError } = require('../middleware/errorHandler');
const { recalcUser } = require('../services/recalcService');

const RANK_COLORS = {
  bronze: '#CD7F32', silver: '#C0C0C0', gold: '#FFD700', platinum: '#14B8A6',
  diamond: '#3B82F6', master: '#9333EA', legend: '#FF6500',
};

function ensureProfile(uid) {
  let p = db.prepare('SELECT * FROM user_profiles WHERE uid = ?').get(uid);
  if (!p) {
    db.prepare(
      `INSERT INTO user_profiles (uid, rank, rank_color) VALUES (?, 'bronze', ?)`,
    ).run(uid, RANK_COLORS.bronze);
    p = db.prepare('SELECT * FROM user_profiles WHERE uid = ?').get(uid);
  }
  return p;
}

const getMe = asyncHandler(async (req, res) => {
  res.json(ensureProfile(req.uid));
});

const patchMe = asyncHandler(async (req, res) => {
  ensureProfile(req.uid);
  const { nickname, profileImageUrl } = req.body || {};
  if (nickname !== undefined) {
    if (typeof nickname !== 'string' || nickname.length > 40) {
      throw httpError(400, 'nickname 은 40자 이하 문자열이어야 합니다.');
    }
    db.prepare("UPDATE user_profiles SET nickname = ?, updated_at = datetime('now') WHERE uid = ?").run(
      nickname.trim(),
      req.uid,
    );
  }
  if (profileImageUrl !== undefined) {
    if (typeof profileImageUrl !== 'string' || profileImageUrl.length > 500) {
      throw httpError(400, 'profileImageUrl 형식이 올바르지 않습니다.');
    }
    db.prepare("UPDATE user_profiles SET profile_image_url = ?, updated_at = datetime('now') WHERE uid = ?").run(
      profileImageUrl,
      req.uid,
    );
  }
  res.json(db.prepare('SELECT * FROM user_profiles WHERE uid = ?').get(req.uid));
});

// 기존 device 계정(users.id)을 인증된 Firebase UID 에 연결한다(서버측 재계산의 데이터 소스).
const linkDevice = asyncHandler(async (req, res) => {
  const { deviceUserId } = req.body || {};
  if (!deviceUserId || typeof deviceUserId !== 'string') {
    throw httpError(400, 'deviceUserId 가 필요합니다.');
  }
  const row = db.prepare('SELECT id, firebase_uid FROM users WHERE id = ?').get(deviceUserId);
  if (!row) throw httpError(404, '해당 device 계정을 찾을 수 없습니다.');
  if (row.firebase_uid && row.firebase_uid !== req.uid) {
    throw httpError(409, '이미 다른 계정에 연결된 device 입니다.');
  }
  db.prepare('UPDATE users SET firebase_uid = ? WHERE id = ?').run(req.uid, deviceUserId);
  ensureProfile(req.uid);
  const profile = recalcUser(req.uid);
  res.json({ linked: true, profile });
});

module.exports = { getMe, patchMe, linkDevice, ensureProfile };
