// ============================================================================
// controllers/titlesController.js — 타이틀 조회 + 장착(equip)
// ============================================================================
const { asyncHandler, httpError } = require('../middleware/errorHandler');
const titles = require('../services/titlesService');
const { ensureProfile } = require('./usersController');

const getMine = asyncHandler(async (req, res) => {
  ensureProfile(req.uid);
  res.json({ owned: titles.listForUser(req.uid), catalog: titles.catalog() });
});

// 단 하나만 장착. 보유하지 않은 타이틀은 거부.
const equip = asyncHandler(async (req, res) => {
  ensureProfile(req.uid);
  const { titleKey } = req.body || {};
  if (!titleKey || typeof titleKey !== 'string') {
    throw httpError(400, 'titleKey 가 필요합니다.');
  }
  const ok = titles.equip(req.uid, titleKey);
  if (!ok) throw httpError(409, '보유하지 않은 타이틀입니다.');
  res.json({ equipped: titleKey, owned: titles.listForUser(req.uid) });
});

module.exports = { getMine, equip };
