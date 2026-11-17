"""Stamp a new app version into index.html so phones load each release as one consistent set.

GitHub Pages lets browsers reuse files for up to 10 minutes. Without this, a phone can mix a
new index.html with an old cached pose.js (seen on Android, 16 Nov). Every module URL gets
?v=<version> through the import map, so a new version means new URLs for all modules.

Usage:  python3 tools/set-version.py 1.1.3
"""
import pathlib, re, sys

MODULES = ['app', 'camera', 'pose', 'overlay', 'debug', 'store', 'preview', 'record', 'tracking-quality', 'session',
           'serve-detector', 'features', 'recorder', 'coach']
version = sys.argv[1]
page = pathlib.Path(__file__).resolve().parent.parent / 'index.html'
html = page.read_text(encoding='utf-8')
entries = ',\n'.join(f'  "./js/{m}.js": "./js/{m}.js?v={version}"' for m in MODULES)
block = (f'<!-- version:start -->\n<script type="importmap">\n{{"imports": {{\n{entries}\n}}}}\n</script>\n'
         f'<script type="module" src="js/app.js?v={version}"></script>\n<!-- version:end -->')
html, n = re.subn(r'<!-- version:start -->.*?<!-- version:end -->', block, html, flags=re.S)
if n == 0:
    html, n = re.subn(r'<script type="module" src="js/app.js[^"]*"></script>', block, html)
assert n == 1, 'version block not found'
html = re.sub(r'<html lang="en"[^>]*>', f'<html lang="en" data-version="{version}">', html, count=1)
page.write_text(html, encoding='utf-8')

# Spike test page (WP0): same versioned module URLs, relative to spike/.
spike = page.parent / 'spike' / 'index.html'
if spike.exists():
    sh = spike.read_text(encoding='utf-8')
    entries = ',\n'.join(f'  "../js/{m}.js": "../js/{m}.js?v={version}"' for m in MODULES)
    sblock = (f'<!-- version:start -->\n<script type="importmap">\n{{"imports": {{\n{entries}\n}}}}\n</script>\n'
              f'<script type="module" src="recording.js?v={version}"></script>\n<!-- version:end -->')
    sh, n2 = re.subn(r'<!-- version:start -->.*?<!-- version:end -->', sblock, sh, flags=re.S)
    assert n2 == 1, 'spike version block not found'
    sh = re.sub(r'<html lang="en"[^>]*>', f'<html lang="en" data-version="{version}">', sh, count=1)
    spike.write_text(sh, encoding='utf-8')
print('set version', version)
