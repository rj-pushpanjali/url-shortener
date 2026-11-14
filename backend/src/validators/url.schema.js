// src/validators/url.schema.js
//
// Zod schemas for the URL endpoints.

const { z } = require('zod');

const BODY_ERROR = { invalid_type_error: 'Request body must be a JSON object', required_error: 'Request body must be a JSON object' };

const MAX_LONG_URL_LENGTH = 2048;

// Base62 of a BIGINT is at most 11 characters. Anything else cannot be a
// real short code, so the redirect route can answer 404 without touching
// Redis or PostgreSQL.
const SHORT_CODE_REGEX = /^[0-9a-zA-Z]{1,11}$/;

const longUrl = z
  .string({ required_error: 'longUrl is required', invalid_type_error: 'longUrl is required and must be a string' })
  .trim()
  .min(1, 'longUrl is required and must be a non-empty string')
  .max(MAX_LONG_URL_LENGTH, `longUrl must be at most ${MAX_LONG_URL_LENGTH} characters`)
  .superRefine((value, ctx) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'longUrl must be a valid URL' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'longUrl must use http:// or https://' });
    }
  });

const createUrlSchema = z.object({ longUrl }, BODY_ERROR);

// url_mapping ids are BIGINT (strings in JS): plain digits only, 1 to 19 of them.
const idParamSchema = z.object({
  id: z.string().regex(/^\d{1,19}$/, 'Invalid URL id'),
});

module.exports = { createUrlSchema, idParamSchema, SHORT_CODE_REGEX, MAX_LONG_URL_LENGTH };
