// src/validators/auth.schema.js
//
// Zod schemas for /auth/register and /auth/login. Messages are the
// client-facing 400 messages (validate.middleware.js sends the first one).

const { z } = require('zod');

// bcrypt only uses the first 72 BYTES of a password; reject longer input
// instead of letting two different long passwords hash identically.
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;

const BODY_ERROR = { invalid_type_error: 'Request body must be a JSON object', required_error: 'Request body must be a JSON object' };

const email = z
  .string({ required_error: 'email is required', invalid_type_error: 'email is required' })
  .trim()
  .toLowerCase()
  .max(255, 'email must be a valid email address')
  .email('email must be a valid email address');

const registerSchema = z.object(
  {
    name: z
      .string({ required_error: 'name is required', invalid_type_error: 'name is required' })
      .trim()
      .min(1, 'name is required')
      .max(100, 'name must be at most 100 characters'),
    email,
    password: z
      .string({ required_error: 'password is required', invalid_type_error: 'password is required' })
      .min(PASSWORD_MIN_LENGTH, `password must be at least ${PASSWORD_MIN_LENGTH} characters`)
      .refine((p) => Buffer.byteLength(p, 'utf8') <= PASSWORD_MAX_BYTES, {
        message: `password must be at most ${PASSWORD_MAX_BYTES} bytes`,
      }),
  },
  BODY_ERROR
);

// Login deliberately does NOT enforce the password policy: policy errors on
// login reveal the rules and add nothing. Only "present" is checked.
const loginSchema = z.object(
  {
    email,
    password: z
      .string({ required_error: 'password is required', invalid_type_error: 'password is required' })
      .min(1, 'password is required'),
  },
  BODY_ERROR
);

module.exports = { registerSchema, loginSchema };
