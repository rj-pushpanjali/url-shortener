// src/routes/auth.routes.js
//
// Public routes: no authentication middleware here by design. They ARE
// rate limited, since they're the ones attackers hammer (account spam and
// password guessing). See the README for the limits and why.

const express = require('express');
const { register, login } = require('../controllers/auth.controller');
const { registerLimiter, loginLimiter } = require('../middleware/rateLimiter.middleware');
const validate = require('../middleware/validate.middleware');
const { registerSchema, loginSchema } = require('../validators/auth.schema');

const router = express.Router();

router.post('/register', registerLimiter, validate(registerSchema), register);
router.post('/login', loginLimiter, validate(loginSchema), login);

module.exports = router;
