/* Renders every step of every diagram to PNGs so you can check them by eye.
   Usage (from the repo root, with a local server on port 8765: python3 -m http.server 8765):
     node tools/render-visuals.js [subject-code or visual id] [out-dir]
   Needs Playwright. The site's Sheet connection is switched off for the render. */
const { chromium } = require("playwright");
const fs = require("fs");
const only = process.argv[2] || "";
const out = process.argv[3] || "visual-renders";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const codes = ["CC", "MP", "CM", "HE", "BB", "HL"];
  const list = [];
  codes.forEach((c) => { const p = "data/visuals/" + c + ".json"; if (fs.existsSync(p)) JSON.parse(fs.readFileSync(p, "utf8")).visuals.forEach((v) => list.push(v)); });
  const pick = list.filter((v) => !only || v.subject === only || v.id === only);
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/assets/config.js*", (r) => r.fulfill({ contentType: "application/javascript", body: 'window.MT_CONFIG={apiUrl:"",examDate:"2027-03-01"};' }));
    for (const v of pick) {
      await page.goto("http://localhost:8765/#/visual/" + v.id);
      await page.waitForSelector(".viz");
      await page.evaluate(() => document.documentElement.classList.add("no-anim"));
      for (let i = 0; i < v.steps.length; i++) {
        if (i) await page.click('[data-act="viz-next"]');
        await page.waitForTimeout(scheme === "light" ? 450 : 200);
        if (scheme === "dark" && i < v.steps.length - 1) continue;   // dark: last step only
        const el = await page.$(".viz");
        await el.screenshot({ path: `${out}/${v.id}-${scheme}-${i + 1}.png` });
      }
    }
    if (errors.length) console.log(scheme, "page errors:", errors);
    await ctx.close();
  }
  await browser.close();
  console.log("Rendered", pick.length, "diagrams to", out);
})();
