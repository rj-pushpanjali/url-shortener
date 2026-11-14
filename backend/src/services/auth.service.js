// src/services/auth.service.js
//
// Registration and login logic. No HTTP knowledge, no SQL.

const bcrypt = require('bcrypt');
const AppError = require('../utils/AppError');
const { signToken } = require('../utils/generateToken');
const userRepository = require('../repositories/user.repository');

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS) || 10;

// Used when a login email doesn't exist, so we still perform one bcrypt
// comparison. Without it, "unknown email" returns noticeably faster than
// "wrong password", letting an attacker enumerate registered emails by
// response time. Computed lazily, once.
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash('timing-equalizer-not-a-real-password', SALT_ROUNDS);
  }
  return dummyHashPromise;
}

/**
 * Registers a new user. The password is hashed with bcrypt (salted,
 * deliberately slow) and only the hash is stored.
 */
async function register({ name, email, password }) {
  // Input is already validated and normalised by validate.middleware.js.

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const user = await userRepository.createUser({ name, email, passwordHash });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.created_at,
    };
  } catch (err) {
    if (err.code === '23505') {
      // unique_violation on users.email
      throw new AppError(409, 'Email is already registered');
    }
    throw err; // unexpected: error handler logs it and returns a generic 500
  }
}

/**
 * Verifies credentials and returns a signed JWT. Unknown email and wrong
 * password produce the SAME 401 message, so the response doesn't reveal
 * which emails have accounts.
 */
async function login({ email, password }) {

  const user = await userRepository.findByEmail(email);

  const hashToCompare = user ? user.password_hash : await getDummyHash();
  const passwordMatches = await bcrypt.compare(password, hashToCompare);

  if (!user || !passwordMatches) {
    throw new AppError(401, 'Invalid email or password');
  }

  const token = signToken(user.id);

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

module.exports = { register, login };
