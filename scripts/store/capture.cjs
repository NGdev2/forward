// Captures Google Play store screenshots from the running dev server.
//   npm run dev -- --port 5196 --strictPort   (in another terminal)
//   node scripts/store/capture.cjs [port]
// Writes store/screenshots/raw/*.png at 1080x1920 (9:16, Play's max 2:1 aspect)
// and store/assets/feature-scene.png (1024x500 road scene, HUD hidden).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.argv[2] || 5196;
const ROOT = path.resolve(__dirname, '../..');
const RAW = path.join(ROOT, 'store/screenshots/raw');
fs.mkdirSync(RAW, { recursive: true });

async function seed(p, lang) {
  await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.waitForTimeout(700);
  for (let i = 0; i < 30 && !(await p.evaluate(() => !!window.__dev)); i++) await p.waitForTimeout(200);
  await p.evaluate(async lang => {
    const loot = await import('/src/game/loot.ts');
    const g = window.__game, s = g.state;
    s.stats.onboarded = true; s.stats.worldCycle = 4; s.stats.bestCycle = 4;
    s.addXp(4200); s.stats.statPoints = 0;
    s.stats.talents = { might: 6, guard: 4, vigor: 5, precision: 3 };
    const kit = [['w_blade', 'legendary'], ['o_tideward', 'epic'], ['h_embercrown', 'epic'], ['a_dragonhide', 'legendary'], ['b_emberstride', 'rare'], ['t_emberseal', 'epic']];
    for (const [id, r] of kit) { const it = loot.makeItem(id, r, 16); if (it) { s.addItem(it); s.equip(it); } }
    for (const it of loot.rollLoot(14, 16, s.luck + 12)) s.addItem(it);
    Object.assign(s.stats, { gold: 2480, gems: 145, kills: 318, bossesFelled: 4, perfectParries: 96, battlesWon: 322, distance: 18450, bestDistance: 18450, progress: 4 });
    s.stats.settings.language = lang; s.stats.settings.reducedMotion = false;
    s.stats.hp = s.maxHp; g.save();
  }, lang);
  await p.reload(); await p.waitForTimeout(900);
  for (let i = 0; i < 30 && !(await p.evaluate(() => !!window.__dev)); i++) await p.waitForTimeout(200);
}

async function shoot(p, name) {
  await p.screenshot({ path: path.join(RAW, name) });
  console.log('  ', name);
}

(async () => {
  const b = await chromium.launch();
  for (const lang of ['en', 'fr']) {
    console.log(lang);
    // 405x720 CSS at dpr 8/3 = 1080x1920 device pixels.
    const p = await b.newPage({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 8 / 3 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://localhost:${PORT}/`); await p.waitForTimeout(600);
    await seed(p, lang);
    await p.evaluate(() => window.__dev.quality.setGraphicsQuality('high'));

    await p.evaluate(() => window.__game.goto('title')); await p.waitForTimeout(2200);
    await shoot(p, `${lang}-1-title.png`);

    await p.evaluate(() => window.__game.goto('run')); await p.waitForTimeout(1500);
    // Wait until the three lanes are close enough to read.
    for (let i = 0; i < 80; i++) { const z = await p.evaluate(() => { const r = window.__run; const m = r && r.markers[0]; return m ? m.z - r.travel : 99; }); if (z < 3.2) break; await p.waitForTimeout(60); }
    await shoot(p, `${lang}-2-road.png`);

    await p.evaluate(() => window.__game.goto('combat', { enemy: window.__dev.pickEnemy(16, true) }));
    await p.waitForTimeout(2000);
    await p.evaluate(() => window.__combat.take({ type: 'basic' }));
    for (let i = 0; i < 120; i++) { const t = await p.evaluate(() => window.__combat.qte && window.__combat.qte.t); if (t && t > 0.45) break; await p.waitForTimeout(40); }
    await p.evaluate(() => window.__combat.simulateParry(0)); await p.waitForTimeout(160);
    await shoot(p, `${lang}-3-parry.png`);

    await p.evaluate(async () => {
      const loot = await import('/src/game/loot.ts');
      window.__game.goto('reward', { title: '', icon: '👑', gold: 640, xp: 820, loot: [loot.makeItem('w_starforge', 'mythic', 18), loot.makeItem('h_tidecrest', 'legendary', 18)], allowDouble: true, bossDefeated: false, grantProgress: false });
    });
    await p.waitForTimeout(1900);
    // Title from the real victory flow is set by the combat screen; use the localised "Victory".
    await p.evaluate(() => { const h = document.querySelector('.rw-title'); if (h) h.textContent = document.documentElement.lang === 'fr' ? 'Victoire' : 'Victory'; });
    await shoot(p, `${lang}-4-loot.png`);

    await p.evaluate(() => window.__game.goto('inventory', { from: 'run', tab: 'sets' })); await p.waitForTimeout(1100);
    await shoot(p, `${lang}-5-sets.png`);

    await p.evaluate(() => window.__game.goto('combat', { enemy: window.__dev.pickBoss(4, 16) }));
    await p.waitForTimeout(1600);
    await p.evaluate(() => window.__combat.take({ type: 'basic' }));
    await p.waitForTimeout(700);
    await shoot(p, `${lang}-6-boss.png`);

    await p.evaluate(() => window.__game.goto('shop', { tab: 'relics' })); await p.waitForTimeout(1100);
    await shoot(p, `${lang}-7-trader.png`);

    if (errs.length) console.log('  page errors:', errs);
    await p.close();
  }

  // Feature graphic art: the title vista (canvas only) plus a hero and a boss
  // rendered by the game's own sprite rigs at high resolution.
  const f = await b.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 2 });
  await f.goto(`http://localhost:${PORT}/`); await f.waitForTimeout(600);
  await seed(f, 'en');
  await f.evaluate(() => window.__dev.quality.setGraphicsQuality('high'));
  // The game sits in a phone-width column; let the vista span the full banner.
  await f.addStyleTag({ content: '.title-content,.toast-host{display:none!important} html,body,#game-root,.screen-layer,.screen{max-width:none!important;width:100%!important;margin:0!important}' });
  await f.evaluate(() => { window.__game.goto('title'); }); await f.waitForTimeout(900);
  await f.evaluate(() => window.dispatchEvent(new Event('resize'))); await f.waitForTimeout(1500);
  await f.screenshot({ path: path.join(ROOT, 'store/assets/feature-scene.png') });
  const art = await f.evaluate(async () => {
    const { lookFromEquipment } = await import('/src/render/api.ts');
    const g = window.__game;
    const hero = g.sprites.heroPortrait(lookFromEquipment(g.state.equipment), 460, 'idle').toDataURL('image/png');
    const boss = g.sprites.creaturePortrait('b_wraithqueen', 560).toDataURL('image/png');
    return { hero, boss };
  });
  fs.writeFileSync(path.join(ROOT, 'store/assets/feature-hero.png'), Buffer.from(art.hero.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(ROOT, 'store/assets/feature-boss.png'), Buffer.from(art.boss.split(',')[1], 'base64'));
  console.log('feature art');
  await b.close();
})();
