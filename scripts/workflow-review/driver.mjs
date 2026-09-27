#!/usr/bin/env node
/**
 * A long-lived Playwright browser for workflow reviews.
 *
 * A review drives one activity through many small steps, and relaunching a
 * browser for each would lose the page it is looking at. This keeps one
 * browser open and runs each POSTed script against it, so a step can inspect
 * what the previous step left on screen:
 *
 *   node scripts/workflow-review/driver.mjs &
 *   echo 'await wr.as("admin"); await wr.go("/members"); return wr.text("h1")' \
 *     | scripts/workflow-review/send.sh
 *
 * A script is the body of an async function receiving `wr` (see `helpers`
 * below). Its return value comes back as JSON together with everything the
 * browser reported since the previous script: console errors, uncaught page
 * errors, and every /api/ response of 400 or above. Those events are the
 * point — a screen that renders while a request behind it fails is exactly
 * what a review exists to catch.
 *
 * The server listens on 127.0.0.1 only and runs a script only when it carries
 * the token written to the state directory, since running a script is running
 * arbitrary code as this user.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  ACCOUNTS_FILE,
  STATE_DIR,
  apiCall,
  authFile,
  launchBrowser,
  readEnv,
  readJson,
  signIn,
} from "./lib.mjs";

const PORT = Number(process.env.WR_DRIVER_PORT ?? 9555);
const SHOTS_DIR = join(STATE_DIR, "shots");
const MAX_BODY_BYTES = 1_000_000;

const env = readEnv();
const BASE_URL = env.baseUrl;

mkdirSync(SHOTS_DIR, { recursive: true, mode: 0o700 });
const TOKEN = randomBytes(24).toString("hex");
writeFileSync(join(STATE_DIR, "driver.token"), TOKEN, { mode: 0o600 });
writeFileSync(join(STATE_DIR, "driver.pid"), String(process.pid));

const browser = await launchBrowser();

const state = { context: null, page: null, role: null, events: [] };

function record(event) {
  state.events.push(event);
  if (state.events.length > 500) state.events.shift();
}

function watch(page) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // The failing response itself is reported below with its method and path.
    if (/Failed to load resource/.test(text)) return;
    record({ kind: "console", text: text.slice(0, 500) });
  });
  page.on("pageerror", (err) =>
    record({ kind: "pageerror", text: String(err.message).slice(0, 500) }),
  );
  page.on("response", (res) => {
    const url = res.url();
    if (res.status() < 400 || !url.includes("/api/")) return;
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    record({
      kind: "http",
      status: res.status(),
      method: res.request().method(),
      path,
    });
  });
}

async function open(role, viewport) {
  if (state.context) await state.context.close().catch(() => {});
  const storageState =
    role && existsSync(authFile(role)) ? authFile(role) : undefined;
  if (role && !storageState) {
    throw new Error(
      `no saved session for "${role}"; run seed.mjs or wr.login("${role}")`,
    );
  }
  state.context = await browser.newContext({
    baseURL: BASE_URL,
    storageState,
    viewport: viewport ?? { width: 1280, height: 900 },
  });
  state.page = await state.context.newPage();
  state.role = role ?? null;
  watch(state.page);
  return state.page;
}

function accounts() {
  return readJson(ACCOUNTS_FILE, {});
}

const helpers = {
  /** The current page. A getter, so it is never a page an earlier call closed. */
  get page() {
    return state.page;
  },
  get role() {
    return state.role;
  },
  baseUrl: BASE_URL,
  backendUrl: env.backendUrl,
  accounts,

  /** A signed-out browser. `viewport` defaults to a laptop; pass a phone size to review mobile. */
  fresh: (viewport) => open(null, viewport),

  /** A browser signed in as a seeded role (see accounts.json). */
  as: (role, viewport) => open(role, viewport),

  /** Sign in through the login screen and save the session for `as(role)`. */
  async login(role) {
    const account = accounts()[role];
    if (!account) throw new Error(`no account "${role}" in accounts.json`);
    const page = await open(null);
    const landed = await signIn(page, account.username, account.password);
    await state.context.storageState({ path: authFile(role) });
    state.role = role;
    return landed;
  },

  /** Navigate and wait for the network to settle. */
  async go(path) {
    await state.page.goto(path);
    await state.page
      .waitForLoadState("networkidle", { timeout: 10000 })
      .catch(() => {});
    return state.page.url().replace(BASE_URL, "");
  },

  /** Visible text of the page (or of `selector`), trimmed for reading. */
  async text(selector = "body", max = 3000) {
    const text = await state.page
      .locator(selector)
      .first()
      .innerText({ timeout: 5000 });
    return text.replace(/\n{3,}/g, "\n\n").slice(0, max);
  },

  /** Full-page screenshot to .workflow-review/shots/<name>.png; returns the path. */
  async shot(name) {
    if (!/^[a-z0-9_.-]+$/i.test(name))
      throw new Error(`invalid screenshot name: ${name}`);
    const path = join(SHOTS_DIR, `${name}.png`);
    await state.page.screenshot({ path, fullPage: true });
    return path;
  },

  /** Call the API as the signed-in user, with the CSRF header a mutation needs. */
  api: (method, path, body) => apiCall(state.context, method, path, body),
};

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

async function run(source) {
  state.events = [];
  try {
    const result = await new AsyncFunction("wr", source)(helpers);
    return { ok: true, result, events: state.events };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.stack ?? err).slice(0, 2000),
      events: state.events,
    };
  }
}

await open(null);

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.headers["x-wr-token"] !== TOKEN) {
    res.writeHead(403).end();
    return;
  }
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) req.destroy();
    else chunks.push(chunk);
  });
  req.on("end", async () => {
    const out = await run(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out, null, 2));
  });
});

async function shutdown() {
  server.close();
  await browser.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `workflow-review driver on 127.0.0.1:${PORT} against ${BASE_URL}`,
  );
});
