// src/utils/base62.js
//
// Converts a non-negative integer (a PostgreSQL BIGSERIAL sequence value)
// into a Base62 string, and back. Base62 uses the 62 characters
// [0-9][a-z][A-Z] as "digits" — the same idea as converting a number to
// base 10 or base 16, just with a larger, URL-safe alphabet so the result
// is compact and contains no characters that need escaping in a URL path.
//
// Why Base62 and not Base64: Base64 includes '+', '/', and '=', which are
// not safe to use directly in a URL path segment without encoding. Base62
// sticks to alphanumeric characters only, so a short code can be dropped
// straight into a URL with no encoding concerns.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = BigInt(ALPHABET.length); // 62n

/**
 * Encode a non-negative integer (number, string, or BigInt) into Base62.
 *
 * Algorithm (same shape as converting to any other base):
 *   1. Repeatedly divide the number by 62.
 *   2. The remainder at each step is the index into ALPHABET for the next
 *      digit (least-significant digit first).
 *   3. Stop when the number reaches 0.
 *   4. Reverse the collected digits to get most-significant-digit-first.
 *
 * Example: encode(125)
 *   125 / 62 = 2 remainder 1  → digit '1' (ALPHABET[1])
 *     2 / 62 = 0 remainder 2  → digit '2' (ALPHABET[2])
 *   digits collected low-to-high: ['1', '2'] → reversed: ['2', '1']
 *   result: "21"
 *
 * BigInt is used instead of Number because BIGSERIAL/BIGINT values in
 * PostgreSQL can exceed Number.MAX_SAFE_INTEGER (2^53 - 1); `pg` returns
 * BIGINT columns as strings by default for exactly this reason.
 */
function encode(value) {
  let num = BigInt(value);

  if (num < 0n) {
    throw new Error('base62.encode: value must be non-negative');
  }

  if (num === 0n) {
    return ALPHABET[0];
  }

  let digits = '';
  while (num > 0n) {
    const remainder = num % BASE;
    digits = ALPHABET[Number(remainder)] + digits;
    num = num / BASE; // BigInt division truncates toward zero, like integer division
  }

  return digits;
}

/**
 * Decode a Base62 string back into a BigInt. Not required for the core
 * redirect flow (we look up by short_code directly, not by decoding it
 * back to an ID), but included because it's a natural companion to
 * encode() and useful for debugging/tests.
 */
function decode(code) {
  let num = 0n;
  for (const char of code) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`base62.decode: invalid character "${char}"`);
    }
    num = num * BASE + BigInt(index);
  }
  return num;
}

module.exports = { encode, decode };
