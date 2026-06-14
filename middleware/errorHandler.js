// ============================================================================
// middleware/errorHandler.js — 중앙 에러 핸들러 + 비동기 래퍼 + 404
// ============================================================================
// 컨트롤러가 throw 하거나 reject 한 에러를 한곳에서 JSON 으로 변환한다. err.status
// 가 있으면 그 코드로, 없으면 500. 스택은 클라에 노출하지 않는다.
// ============================================================================

/** async 컨트롤러를 감싸 에러를 next 로 흘려보낸다. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** 표준 에러 객체 생성 헬퍼. */
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function notFound(req, res) {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars  (Express 는 4-arity 로 에러 핸들러를 인식)
function errorHandler(err, req, res, next) {
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  const message = (err && err.message) || 'Internal Server Error';
  if (status >= 500) console.error('API error:', err);
  res.status(status).json({ error: message });
}

module.exports = { asyncHandler, httpError, notFound, errorHandler };
