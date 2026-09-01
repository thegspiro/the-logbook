import { chromium } from "playwright";
const [route, who="admin", needle=""] = process.argv.slice(2);
const cr = who==="member"?{u:"nbelhaj",p:"DemoMember!2026"}:{u:"chief",p:process.env.SCREENSHOT_ADMIN_PASSWORD};
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_BROWSERS_PATH?`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`:undefined });
const p = await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto("http://localhost:3000/login",{waitUntil:"domcontentloaded"});
await p.fill("#username",cr.u); await p.fill("#password",cr.p); await p.click("button[type=submit]");
await p.waitForTimeout(3000);
await p.goto(`http://localhost:3000${route}`,{waitUntil:"networkidle"}); await p.waitForTimeout(2500);
console.log("URL:", p.url());
console.log("labels:", JSON.stringify(await p.locator("label").allInnerTexts()));
if (needle) {
  const el = p.getByText(needle, { exact: false }).first();
  console.log("needle count:", await p.getByText(needle,{exact:false}).count());
  const cls = await el.evaluate(e => { let n=e, out=[]; for(let i=0;i<4&&n;i++){out.push(n.tagName+"."+String(n.className).slice(0,70)); n=n.parentElement;} return out; }).catch(()=>null);
  console.log("ancestry:", JSON.stringify(cls, null, 1));
}
await b.close();
