// Turns store/screenshots/raw/*.png into designed Play Store images:
//   store/screenshots/<lang>/<n>.png   1080x1920, headline + framed screenshot
//   store/assets/feature-<lang>.png    1024x500 feature graphic
// Run after capture.cjs:  node scripts/store/frames.cjs && python3 scripts/store/to-jpeg.py
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..');
const RAW = path.join(ROOT, 'store/screenshots/raw');

const CAPTIONS = {
  en: {
    '1-title': ['An endless road', 'Pick a lane. Fight. Loot. Repeat.'],
    '2-road': ['Three lanes, one choice', 'Monsters, chests, shrines, traders: you decide.'],
    '3-parry': ['Parry at the perfect moment', 'Tap as the blow lands to cut it by 70%.'],
    '4-loot': ['Loot hundreds of items', 'Six rarities, random affixes, mythic drops.'],
    '5-sets': ['Build your relic sets', 'Six sets with fire, water, void and light powers.'],
    '6-boss': ['Face twenty bosses', 'Each with phases, passives and a signature move.'],
    '7-trader': ['Trade with gold or gems', 'Rare relics wait at every trader.'],
    tagline: 'The road never ends',
    kicker: 'RPG RUNNER'
  },
  fr: {
    '1-title': ['Une route sans fin', 'Choisissez une voie. Combattez. Pillez.'],
    '2-road': ['Trois voies, un choix', 'Monstres, coffres, sanctuaires, marchands : à vous de choisir.'],
    '3-parry': ['Parez au moment parfait', "Touchez à l'impact pour réduire le coup de 70 %."],
    '4-loot': ["Des centaines d'objets", 'Six raretés, affixes aléatoires, butins mythiques.'],
    '5-sets': ['Réunissez vos ensembles', "Six ensembles aux pouvoirs de feu, d'eau, de néant et de lumière."],
    '6-boss': ['Affrontez vingt boss', 'Chacun avec ses phases, ses passifs et son coup signature.'],
    '7-trader': ['Or ou gemmes', 'Des reliques rares chez chaque marchand.'],
    tagline: 'La route ne finit jamais',
    kicker: 'RPG RUNNER'
  }
};

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Inter:wght@500;600&display=block" rel="stylesheet">`;
const dataUrl = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

function framePage(img, head, sub) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  *{margin:0;box-sizing:border-box}
  body{width:1080px;height:1920px;overflow:hidden;font-family:Inter,sans-serif;
    background:radial-gradient(900px 600px at 50% 18%,rgba(242,193,78,.22),transparent 70%),
               linear-gradient(180deg,#070a18 0%,#12173a 45%,#1d1236 100%);}
  .stars{position:absolute;inset:0;background-image:radial-gradient(2px 2px at 12% 8%,#fff8,transparent),radial-gradient(2px 2px at 84% 12%,#fff6,transparent),radial-gradient(1.5px 1.5px at 30% 22%,#fff7,transparent),radial-gradient(1.5px 1.5px at 70% 5%,#fff7,transparent),radial-gradient(2px 2px at 92% 30%,#fff5,transparent),radial-gradient(1.5px 1.5px at 6% 34%,#fff6,transparent)}
  .head{position:absolute;top:92px;left:60px;right:60px;text-align:center}
  h1{font-family:Cinzel,serif;font-weight:900;font-size:84px;line-height:1.05;letter-spacing:1px;
     background:linear-gradient(180deg,#fff3cf 0%,#f2c14e 55%,#d0892b 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
     filter:drop-shadow(0 4px 18px rgba(242,193,78,.35))}
  p{margin-top:22px;font-size:38px;font-weight:500;color:#cdd3ea;line-height:1.3}
  .shot{position:absolute;left:50%;top:380px;width:830px;height:1476px;transform:translateX(-50%);
     border-radius:54px;overflow:hidden;border:3px solid rgba(242,193,78,.55);
     box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 12px rgba(255,255,255,.04)}
  .shot img{width:100%;height:100%;display:block}
  </style></head><body><div class="stars"></div>
  <div class="head"><h1>${head}</h1><p>${sub}</p></div>
  <div class="shot"><img src="${img}"></div></body></html>`;
}

function featurePage(scene, hero, boss, tagline, kicker) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  *{margin:0;box-sizing:border-box}
  body{width:1024px;height:500px;overflow:hidden;position:relative;font-family:Inter,sans-serif;background:#070a18}
  .bg{position:absolute;inset:0;background:url(${scene}) center/cover}
  .shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(7,10,24,.88) 0%,rgba(7,10,24,.55) 40%,rgba(7,10,24,0) 66%)}
  .glow{position:absolute;right:10px;top:30px;width:440px;height:440px;border-radius:50%;
        background:radial-gradient(circle,rgba(255,110,70,.45),rgba(255,110,70,0) 65%)}
  .boss{position:absolute;right:-30px;bottom:-10px;height:440px;transform:scaleX(-1);filter:drop-shadow(0 10px 24px rgba(0,0,0,.6))}
  .hero{position:absolute;right:250px;bottom:-12px;height:330px;filter:drop-shadow(0 10px 20px rgba(0,0,0,.6)) drop-shadow(0 0 18px rgba(127,216,255,.35))}
  .logo{position:absolute;left:58px;top:50%;transform:translateY(-50%)}
  .kicker{font-weight:600;font-size:18px;letter-spacing:8px;color:#9fb0e8;margin-bottom:10px}
  h1{font-family:Cinzel,serif;font-weight:900;font-size:84px;letter-spacing:7px;line-height:1;
     background:linear-gradient(180deg,#fff3cf 0%,#f2c14e 55%,#c9822b 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
     filter:drop-shadow(0 6px 22px rgba(242,193,78,.45))}
  .tag{margin-top:16px;font-size:22px;letter-spacing:5px;text-transform:uppercase;color:#e7ddc4}
  </style></head><body><div class="bg"></div><div class="shade"></div><div class="glow"></div>
  <img class="boss" src="${boss}"><img class="hero" src="${hero}">
  <div class="logo"><div class="kicker">${kicker}</div><h1>FORWARD</h1><div class="tag">${tagline}</div></div></body></html>`;
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  for (const lang of Object.keys(CAPTIONS)) {
    const out = path.join(ROOT, 'store/screenshots', lang);
    fs.mkdirSync(out, { recursive: true });
    for (const [key, [head, sub]] of Object.entries(CAPTIONS[lang])) {
      if (typeof head !== 'string' || key === 'tagline' || key === 'kicker') continue;
      const src = path.join(RAW, `${lang}-${key}.png`);
      if (!fs.existsSync(src)) { console.log('missing', src); continue; }
      await p.setContent(framePage(dataUrl(src), head, sub), { waitUntil: 'networkidle' });
      await p.evaluate(() => document.fonts.ready);
      const png = path.join(out, `${key}.png`);
      await p.screenshot({ path: png });
      console.log(`${lang}/${key}.png`);
    }
  }
  await p.setViewportSize({ width: 1024, height: 500 });
  const A = n => dataUrl(path.join(ROOT, `store/assets/${n}.png`));
  for (const lang of Object.keys(CAPTIONS)) {
    await p.setContent(featurePage(A('feature-scene'), A('feature-hero'), A('feature-boss'), CAPTIONS[lang].tagline, CAPTIONS[lang].kicker), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(ROOT, `store/assets/feature-${lang}.png`) });
    console.log(`feature-${lang}.png`);
  }
  await b.close();
})();
