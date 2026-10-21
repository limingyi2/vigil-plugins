"""Build a deterministic package from an explicit, clean Git commit.

Usage: python tools/package_plugin.py wallpaper <commit>
Never reads the working tree payload or includes a previous ZIP.
"""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile


def build(name, ref):
    root = Path(__file__).resolve().parents[1]
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args])
    commit = git('rev-parse', '--verify', ref + '^{commit}').decode().strip()
    prefix = 'plugins/' + name + '/'
    names = git('ls-tree', '-r', '--name-only', commit, '--', prefix).decode().splitlines()
    payload = {n[len(prefix):]: git('show', commit + ':' + n)
               for n in names if not n.endswith(('.zip', '/manifest.json'))}
    if any('/' in n for n in payload):
        raise ValueError('Nested payload is unsupported by the installer')
    manifest = json.loads(git('show', commit + ':' + prefix + 'manifest.json'))
    if manifest['name'] != name or json.loads(payload['version.json'])['version'] != manifest['version']:
        raise ValueError('Plugin name/version metadata mismatch')
    manifest['files'] = [{'path': n, 'sha256': hashlib.sha256(b).hexdigest()}
                         for n, b in sorted(payload.items())]
    payload['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    buffer = io.BytesIO()
    # Stored entries keep the exact package bytes reproducible across Windows/Python
    # and Linux/Python zlib versions. Hashes in market.json must match CI rebuilds.
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_STORED) as archive:
        for n, b in sorted(payload.items()):
            info = zipfile.ZipInfo(name + '/' + n, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, b)
    package = buffer.getvalue()
    # Verify the exact archive bytes before publishing anything.
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        actual = {n[len(name) + 1:]: hashlib.sha256(archive.read(n)).hexdigest()
                  for n in archive.namelist() if n != name + '/manifest.json'}
        assert actual == {f['path']: f['sha256'] for f in manifest['files']}
    directory = root / prefix
    (directory / 'manifest.json').write_bytes(payload['manifest.json'])
    filename = name + '-' + manifest['version'] + '.zip'
    (directory / filename).write_bytes(package)
    market = json.loads((root / 'market.json').read_text(encoding='utf-8'))
    item = next(p for p in market['plugins'] if p['name'] == name)
    if item['version'] != manifest['version']:
        raise ValueError('Market version mismatch')
    item['artifact']['sha256'] = hashlib.sha256(package).hexdigest()
    (root / 'market.json').write_text(json.dumps(market, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'source_commit': commit, 'artifact': filename,
                      'sha256': item['artifact']['sha256'], 'files': manifest['files']}, indent=2))


if __name__ == '__main__':
    build(*sys.argv[1:])
