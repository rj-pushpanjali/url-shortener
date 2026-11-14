// src/utils/generateToken.js
//
// Signs and verifies JWTs. Stateless authentication: the token itself
// carries the user id, signed with a secret only the server knows. Any
// backend instance holding the same JWT_SECRET can verify it, with no
// shared session store. That is what lets Stage 10/11 run several
// instances behind Nginx without sticky sessions.
//
// Environment is read at call time (not module load) so dotenv has
// already run. server.js checks JWT_SECRET at startup and refuses to
// boot without it.

const jwt = require('jsonwebtoken');

const ALGORITHM = 'HS256';

function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  });
}

/**
 * Returns the decoded payload, or throws (jsonwebtoken's
 * JsonWebTokenError / TokenExpiredError). The algorithm is pinned on
 * verify so a token claiming a different algorithm (e.g. "none") is
 * rejected.
 */
function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: [ALGORITHM] });
}

module.exports = { signToken, verifyToken };
