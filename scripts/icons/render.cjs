// Renders every launcher icon, splash screen and store graphic from
// scripts/icons/icon.html (procedural canvas art — no source images).
//   node scripts/icons/render.cjs
// Writes: android/app/src/main/res/{mipmap-*,drawable*}, public/icons/*,
//         store/assets/{store-icon-512.png, feature-1024x500.png}
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const RES = path.join(ROOT, 'android/app/src/main/res');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, 'icon.html'));
  const save = async (file, kind, w, h) => {
    const d = await p.evaluate(([k, w, h]) => draw(k, w, h), [kind, w, h]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(d.split(',')[1], 'base64'));
  };
  const hasAndroid = fs.existsSync(RES);
  if (hasAndroid) {
    const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [d, k] of Object.entries(dens)) {
      await save(`${RES}/mipmap-${d}/ic_launcher.png`, 'icon', 48 * k, 48 * k);
      await save(`${RES}/mipmap-${d}/ic_launcher_round.png`, 'icon', 48 * k, 48 * k);
      await save(`${RES}/mipmap-${d}/ic_launcher_foreground.png`, 'fg', 108 * k, 108 * k);
    }
    const splash = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
    for (const [d, [w, h]] of Object.entries(splash)) {
      await save(`${RES}/drawable-port-${d}/splash.png`, 'splash', w, h);
      await save(`${RES}/drawable-land-${d}/splash.png`, 'splash', h, w);
    }
    await save(`${RES}/drawable/splash.png`, 'splash', 480, 800);
  } else {
    console.warn('android/ not found — skipping launcher icons (run `npx cap add android` first).');
  }
  await save(path.join(ROOT, 'public/icons/icon-192.png'), 'icon', 192, 192);
  await save(path.join(ROOT, 'public/icons/icon-512.png'), 'icon', 512, 512);
  await save(path.join(ROOT, 'store/assets/store-icon-512.png'), 'icon', 512, 512);
  await save(path.join(ROOT, 'store/assets/feature-1024x500.png'), 'splash', 1024, 500);
  await b.close();
  console.log('icons rendered');
})();
