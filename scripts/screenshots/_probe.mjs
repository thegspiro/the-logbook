// Throwaway DOM probe: node scripts/screenshots/_probe.mjs <route> [member|admin]
import { chromium } from "playwright";
const [route, who = "admin"] = process.argv.slice(2);
const creds = who === "member"
  ? { u: "nbelhaj", p: "DemoMember!2026" }
  : { u: "chief", p: process.env.SCREENSHOT_ADMIN_PASSWORD };
const b = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_BROWSERS_PATH
    ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined,
});
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
await p.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
await p.fill("#username", creds.u);
await p.fill("#password", creds.p);
await p.click("button[type=submit]");
await p.waitForTimeout(3000);
await p.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const texts = await p.evaluate(() => {
  const seen = new Set();
  const out = [];
  document.querySelectorAll("button, [role='tab'], a[href], summary").forEach((el) => {
    const t = (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const vis = !!(el.offsetWidth || el.offsetHeight);
    if (!t || seen.has(t + vis)) return;
    seen.add(t + vis);
    out.push(`${vis ? "  " : "x "}${el.tagName.toLowerCase()}: ${t}`);
  });
  return out;
});
console.log("URL:", p.url());
console.log("--- clickable (x = hidden) ---");
console.log(texts.join("\n"));
await b.close();
