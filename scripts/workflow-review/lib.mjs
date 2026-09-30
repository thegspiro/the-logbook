/**
 * Shared by the workflow-review driver and seed: where state lives, how to
 * launch Chromium, and how a browser signs in.
 */
import { chromium } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const STATE_DIR =
  process.env.WR_STATE_DIR ?? join(ROOT, ".workflow-review");
export const ACCOUNTS_FILE = join(STATE_DIR, "accounts.json");

// POST /auth/login allows 5 attempts a minute per IP and locks the IP out for
// half an hour past that, so anything signing in several accounts in a row
// must pace itself rather than retry.
export const LOGIN_INTERVAL_MS = 13_000;

// The limit is per address, so it is shared by every driver on this machine.
// Two drivers each pacing only their own sign-ins can together exceed it,
// and the half-hour lockout then stops both. The moment of the last sign-in
// is therefore kept in a file every driver reads and writes under a lock,
// and a second driver with its own state directory points WR_SIGNIN_PACE_FILE
// at the first one's copy so they pace as one.
export const SIGNIN_PACE_FILE =
  process.env.WR_SIGNIN_PACE_FILE ?? join(STATE_DIR, "last-signin");
const SIGNIN_LOCK_STALE_MS = 120_000;

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function readEnv() {
  const env = readJson(join(STATE_DIR, "env.json"), null);
  if (!env) {
    throw new Error(
      `No ${join(STATE_DIR, "env.json")}: run scripts/workflow-review/start.sh first.`,
    );
  }
  return env;
}

export function authFile(role) {
  if (!/^[a-z0-9_-]+$/i.test(role))
    throw new Error(`invalid role name: ${role}`);
  return join(STATE_DIR, `auth-${role}.json`);
}

// The container images this project runs in ship a Chromium that does not
// match the build @playwright/test expects, so the default launch fails
// looking for a browser that is not installed. Prefer an explicit path.
export function launchBrowser() {
  let executablePath = process.env.WR_CHROMIUM;
  if (!executablePath && existsSync("/opt/pw-browsers/chromium")) {
    executablePath = "/opt/pw-browsers/chromium";
  }
  // No background networking: the browser only needs the review servers, and
  // its update and safe-browsing checks would otherwise reach the internet.
  return chromium.launch({
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-background-networking",
      "--disable-component-update",
    ],
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sign in no sooner than LOGIN_INTERVAL_MS after the previous sign-in from any
 * driver sharing SIGNIN_PACE_FILE. The lock directory is held for the whole
 * sign-in, so two drivers that wake at once still go one after the other; a
 * lock older than SIGNIN_LOCK_STALE_MS belongs to a driver that died holding
 * it and is taken over.
 */
export async function pacedSignIn(page, username, password) {
  const lockDir = `${SIGNIN_PACE_FILE}.lock`;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      let age = 0;
      try {
        age = Date.now() - statSync(lockDir).mtimeMs;
      } catch {
        continue;
      }
      if (age > SIGNIN_LOCK_STALE_MS) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      await sleep(500);
    }
  }
  try {
    let last = 0;
    try {
      last = Number(readFileSync(SIGNIN_PACE_FILE, "utf8")) || 0;
    } catch {
      last = 0;
    }
    const wait = last + LOGIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    writeFileSync(SIGNIN_PACE_FILE, String(Date.now()));
    return await signIn(page, username, password);
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/** Sign in through the login screen. Resolves to the path the app lands on. */
export async function signIn(page, username, password) {
  await page.goto("/login");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page
    .locator('form[aria-label="Sign in form"] button[type="submit"]')
    .click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20000,
  });
  await page
    .waitForLoadState("networkidle", { timeout: 10000 })
    .catch(() => {});
  return new URL(page.url()).pathname;
}

/** Call the API from a browser context, with the CSRF header a mutation needs. */
export async function apiCall(context, method, path, body) {
  const cookies = await context.cookies();
  const csrf = cookies.find((c) => c.name === "csrf_token")?.value;
  const res = await context.request.fetch(`/api/v1${path}`, {
    method,
    data: body,
    headers: csrf ? { "X-CSRF-Token": csrf } : {},
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 2000);
  }
  return { status: res.status(), body: json };
}
