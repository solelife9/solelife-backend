// ============================================================================
// middleware/auth.js — Firebase ID 토큰 검증(보호 라우트 필수)
// ============================================================================
// 보안(steer R4 필수): 모든 보호 라우트는 Authorization: Bearer <idToken> 을 검증하고
// req.uid 에 검증된 Firebase UID 를 싣는다. 본인 데이터만 수정하도록 컨트롤러는 req.uid
// 만 신뢰한다(클라가 보낸 uid 바디는 무시).
// ============================================================================
const { isConfigured, verifyIdToken } = require('../services/firebaseAdmin');

async function requireAuth(req, res, next) {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Firebase 인증이 서버에 설정되지 않았습니다.' });
  }
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ error: 'Authorization Bearer 토큰이 필요합니다.' });
  }
  try {
    const decoded = await verifyIdToken(m[1]);
    if (!decoded || !decoded.uid) {
      return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    }
    req.uid = decoded.uid;
    req.authToken = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: '토큰 검증 실패', detail: String((e && e.message) || e) });
  }
}

module.exports = { requireAuth };
