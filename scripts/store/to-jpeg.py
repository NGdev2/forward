"""Converts designed store screenshots (PNG) to JPEG for Play (no alpha, small).
Run after frames.cjs:  python3 scripts/store/to-jpeg.py"""
import glob, os
from PIL import Image

for f in glob.glob('store/screenshots/*/*.png'):
    if '/raw/' in f:
        continue
    Image.open(f).convert('RGB').save(f[:-4] + '.jpg', quality=92, optimize=True, progressive=True)
    os.remove(f)
for f in glob.glob('store/assets/feature-??.png'):
    im = Image.open(f)
    if im.mode != 'RGB':
        im.convert('RGB').save(f, optimize=True)
print('done')
