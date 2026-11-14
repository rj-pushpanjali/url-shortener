// src/middleware/auth.middleware.js
//
// Protects routes. Expects:   Authorization: Bearer <jwt>
// On success sets req.user = { id } and calls next(). On any failure
// responds 401 through the centralized error handler.
//
// Stateless by design: it verifies the signature and expiry only, with
// no database or Redis lookup, so any backend instance can authenticate
// any request. Trade-off: a token stays valid until it expires even if
// the user is later deleted. Acceptable here; short expiry bounds it.

const AppError = require('../utils/AppError');
const { verifyToken } = require('../utils/generateToken');

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'Authentication required'));
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub };
    return next();
  } catch (err) {
    // Expired, malformed, wrong signature, wrong algorithm: all the same
    // to the client. Details stay out of the response.
    return next(new AppError(401, 'Invalid or expired token'));
  }
}

module.exports = authenticate;
