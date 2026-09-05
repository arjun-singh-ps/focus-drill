// The single-user password gate.
//
// There is no user table and no Supabase Auth here — one shared password unlocks
// the app, and a signed cookie keeps her logged in across devices. The cookie is
// an HMAC over its own expiry, so it cannot be forged without SESSION_SECRET and
// cannot be extended by editing it.
//
// Everything uses Web Crypto (crypto.subtle) rather than node:crypto because
// src/proxy.ts runs in the edge runtime, where node:crypto is unavailable.

/** Cookie name. Prefixed to make it obvious in devtools which cookie this is. */
export const SESSION_COOKIE = "focus_drill_session";

/** How long a login lasts. Long, because re-typing a password mid-revision is friction. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Reads SESSION_SECRET, failing loudly rather than silently signing with undefined. */
function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Add it to .env.local — generate one with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return secret;
}

/** Base64url-encodes bytes (no padding), so the value is cookie-safe. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HMAC-SHA256 of `message` under SESSION_SECRET, base64url-encoded. */
async function sign(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

/**
 * Compares two strings in time independent of where they first differ.
 *
 * A naive `===` leaks, through timing, how many leading characters matched, which
 * over many attempts lets an attacker reconstruct a secret one character at a time.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Checks a submitted password against APP_PASSWORD.
 *
 * @param submitted the password from the login form
 */
export function isCorrectPassword(submitted: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    throw new Error("APP_PASSWORD is not set. Add it to .env.local.");
  }
  return timingSafeEqual(submitted, expected);
}

/**
 * Mints a session token of the form `<expiryEpochSeconds>.<hmac>`.
 *
 * The expiry is inside the signed payload rather than relying on the cookie's own
 * Max-Age, because a client can keep sending an expired cookie — only the signature
 * makes the expiry binding.
 */
export async function createSessionToken(now: Date = new Date()): Promise<string> {
  const expiresAt = Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = String(expiresAt);
  return `${payload}.${await sign(payload)}`;
}

/**
 * Verifies a session token: correct signature, and not yet expired.
 *
 * @param token the raw cookie value, or undefined when no cookie was sent
 */
export async function verifySessionToken(
  token: string | undefined,
  now: Date = new Date()
): Promise<boolean> {
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const providedSignature = token.slice(separator + 1);

  const expectedSignature = await sign(payload);
  if (!timingSafeEqual(providedSignature, expectedSignature)) return false;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt)) return false;

  return Math.floor(now.getTime() / 1000) < expiresAt;
}

/** Cookie options shared by the login route and any future logout route. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;
