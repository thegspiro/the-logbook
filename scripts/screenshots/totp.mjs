/**
 * Authenticator codes for the demo administrator's browser sign-in.
 *
 * Privileged members are required to use two-factor, so `seed_demo_data.py`
 * enrols the administrator in TOTP and stores the secret outside the
 * repository. capture.mjs reads it from here and types the code into the login
 * page's code step. This is the Node twin of `totp_now` in the seeder — RFC
 * 6238 with SHA-1, built on node:crypto so the pipeline gains no dependency —
 * and `scripts/test_screenshot_admin_mfa.py` holds both to the same RFC vector.
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ADMIN_TOTP_ENV = "SCREENSHOT_ADMIN_TOTP_SECRET";
export const TOTP_PERIOD_SECONDS = 30;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(secret) {
  const clean = secret.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("TOTP secret is not valid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** The code for time-step `step` (unix seconds / 30). */
export function totpForStep(secret, step, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  // Dynamic truncation: the low nibble of the last byte picks the offset.
  const offset = digest[digest.length - 1] & 0x0f;
  const code = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(code % 10 ** digits).padStart(digits, "0");
}

/** The time-step a unix time in seconds falls in. */
export function totpStep(unixSeconds = Date.now() / 1000) {
  return Math.floor(unixSeconds / TOTP_PERIOD_SECONDS);
}

/**
 * Where the seeder keeps the administrator's secret. An empty XDG_STATE_HOME
 * counts as unset, matching `${XDG_STATE_HOME:-...}` in dev_env.sh and
 * `admin_totp_path()` in the seeder.
 */
export function adminTotpPath(env = process.env) {
  const state = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(state, "logbook-screenshots", "admin-totp.env");
}

/** The secret from the env override, else the seeder's file, else null. */
export function readAdminTotpSecret(env = process.env) {
  const override = (env[ADMIN_TOTP_ENV] || "").trim();
  if (override) return override;
  let text;
  try {
    text = readFileSync(adminTotpPath(env), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at === -1) continue;
    const value = line.slice(at + 1).trim();
    if (line.slice(0, at).trim() === ADMIN_TOTP_ENV && value) return value;
  }
  return null;
}

/**
 * What a `POST /auth/mfa/login` status says about the code that was sent.
 *
 * Both sign-in limiters (the per-address login allowance and the
 * suspicious-network throttle) answer 429 before the code is ever checked, and
 * the seeder spends that same allowance moments before a capture. Reading a
 * 429 as a wrong code blames the stored secret for a wait, so it is kept apart:
 * `throttled` is waited out, `refused` is a code the server actually rejected.
 */
export function codeStepVerdict(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429) return "throttled";
  return "refused";
}
