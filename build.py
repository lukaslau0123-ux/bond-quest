import re, os, sys, hashlib
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))

def read(rel):
    with open(os.path.join(BASE, rel), encoding='utf-8') as f:
        return f.read()

def main():
    tpl = read('_src/template.html')
    parts = {
        'CSS': read('_src/styles.css'),
        'THREE': read('_vendor/three.min.js'),
        'DATA': read('_src/data.js'),
        'CLOUD': read('_src/cloud.js'),
        'WORLD': read('_src/world.js'),
        'MODELS': read('_src/models-preview.js'),
        'VARIANTS': read('_src/models-variants.js'),
        'AMBIENT': read('_src/ambient.js'),
        'GAME': read('_src/game.js'),
    }
    for k in ('THREE', 'DATA', 'CLOUD', 'MODELS', 'VARIANTS', 'AMBIENT', 'WORLD', 'GAME'):
        if '</script' in parts[k].lower():
            sys.exit('ERROR: %s contains </script>' % k)

    def repl(m):
        return parts[m.group(1)]

    out = re.sub(r'/\*__(CSS|THREE|DATA|CLOUD|MODELS|VARIANTS|AMBIENT|WORLD|GAME)__\*/', repl, tpl)

    # 建置戳記：查看原始碼即可確認線上版本與建置時間
    stamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    digest = hashlib.sha256(''.join(parts[k] for k in ('CSS', 'DATA', 'WORLD', 'GAME')).encode('utf-8')).hexdigest()[:12]
    out = out.replace('<head>', '<head>\n<!-- build: %s | src: %s -->' % (stamp, digest), 1)

    path = os.path.join(BASE, 'index.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('built %s  %.1f KB' % (path, os.path.getsize(path) / 1024))

    # keep the publish folder (site/) in sync so deployments always ship the latest build
    site_dir = os.path.join(BASE, 'site')
    os.makedirs(site_dir, exist_ok=True)
    site_path = os.path.join(site_dir, 'index.html')
    with open(site_path, 'w', encoding='utf-8') as f:
        f.write(out)
    print('synced %s  %.1f KB' % (site_path, os.path.getsize(site_path) / 1024))

if __name__ == '__main__':
    main()
