// src/utils/parseTrustProxy.js
//
// Turns the TRUST_PROXY env var into the value for Express's
// app.set('trust proxy', ...).
//
// WHY IT MATTERS FOR RATE LIMITING: limits are keyed by client IP (req.ip).
// Behind Nginx (Stage 11) the TCP connection comes from Nginx, so without
// this setting every user would appear to have Nginx's IP and would all
// share ONE rate-limit budget. With trust proxy set, Express reads the
// real client IP from the X-Forwarded-For header that Nginx adds.
//
// But if the app is exposed directly and we trust that header, any client
// can send a fake X-Forwarded-For and dodge the limit. So the default is
// OFF, and you opt in with the exact number of proxies in front of the app
// (Nginx alone = 1). "true" (trust everything) is rejected for that reason.
//
//   unset / "false"  -> off (default; correct for local dev without Nginx)
//   "1", "2", ...    -> trust that many proxy hops
//   "loopback", "172.18.0.0/16", ... -> trust those addresses (Express syntax)

function parseTrustProxy(value) {
  if (value === undefined || value === null) return false;

  const text = String(value).trim();
  if (text === '' || text.toLowerCase() === 'false') return false;

  if (text.toLowerCase() === 'true') {
    throw new Error(
      'TRUST_PROXY=true trusts every X-Forwarded-For header, which lets clients fake their IP and bypass rate limits. ' +
        'Use the number of proxies in front of the app (e.g. TRUST_PROXY=1 behind Nginx).'
    );
  }

  if (/^\d+$/.test(text)) return Number(text);
  return text; // address / subnet / keyword, handled by Express
}

module.exports = parseTrustProxy;
