// ============================================================================
// services/firebaseAdmin.js — firebase-admin 싱글톤(ID 토큰 검증/커스텀 토큰 공용)
// ============================================================================
// 환경변수 FIREBASE_SERVICE_ACCOUNT 에 서비스계정 JSON(문자열 통째)을 넣는다.
// 이는 danger zone(자격증명)이라 배포 환경에서 사용자가 설정한다. 미설정이면
// getAdmin() 이 throw 하고, 보호 라우트는 503(설정 안 됨)으로 응답하게 한다.
// ============================================================================
let _admin = null;

function getAdmin() {
  if (_admin) return _admin;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT 환경변수가 없습니다.');
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  _admin = admin;
  return admin;
}

function isConfigured() {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT;
}

/** ID 토큰을 검증해 디코딩된 토큰(uid 포함)을 돌려준다. */
async function verifyIdToken(idToken) {
  return getAdmin().auth().verifyIdToken(idToken);
}

module.exports = { getAdmin, isConfigured, verifyIdToken };
