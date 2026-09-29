// Drives the debug build's WebView over Chrome DevTools (adb-forwarded to
// localhost:9333) and measures frame rate per screen. Uses the non-production
// hooks window.__game / __combat / __dev.
const { chromium } = require('playwright');

const fps = (p, ms = 3500) =>
  p.evaluate(ms => new Promise(res => {
    const t = []; let last = performance.now(); const end = last + ms;
    const f = now => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else res(t); };
    requestAnimationFrame(f);
  }), ms).then(fr => {
    const s = fr.slice(2).sort((a, b) => a - b);
    const avg = s.reduce((a, b) => a + b, 0) / s.length;
    return `${(1000 / avg).toFixed(1).padStart(5)} fps  median ${s[s.length >> 1].toFixed(0)}ms  p90 ${s[Math.floor(s.length * 0.9)].toFixed(0)}ms`;
  });

(async () => {
  const b = await chromium.connectOverCDP('http://localhost:9333');
  let p;
  for (let i = 0; i < 40 && !p; i++) {
    p = b.contexts().flatMap(c => c.pages()).find(x => x.url().startsWith('https://localhost'));
    if (!p) await new Promise(r => setTimeout(r, 250));
  }
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  for (let i = 0; i < 40; i++) { if (await p.evaluate(() => !!(window.__game && window.__dev))) break; await p.waitForTimeout(250); }
  await p.evaluate(() => { const s = window.__game.state.stats; s.onboarded = true; window.__game.save(); });
  for (const q of (process.env.MODES || 'balanced,high').split(',')) {
    await p.evaluate(q => window.__dev.quality.setGraphicsQuality(q), q);
    await p.evaluate(() => window.__game.goto('title')); await p.waitForTimeout(1500);
    console.log(`[${q}] title  `, await fps(p));
    await p.evaluate(() => window.__game.goto('run')); await p.waitForTimeout(2500);
    console.log(`[${q}] road   `, await fps(p, 6000));
    await p.evaluate(() => { window.__game.state.stats.hp = window.__game.state.maxHp; window.__game.goto('combat', { enemy: window.__dev.pickEnemy(12, true) }); });
    await p.waitForTimeout(2500);
    console.log(`[${q}] elite  `, await fps(p));
    await p.evaluate(() => window.__game.goto('combat', { enemy: window.__dev.pickBoss(2, 12) }));
    await p.waitForTimeout(2500);
    console.log(`[${q}] boss   `, await fps(p));
  }
  await p.evaluate(() => window.__game.goto('title'));
  console.log('page errors:', errs.length ? errs : 'none');
  await b.close();
})();
