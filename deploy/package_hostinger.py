"""Builds deploy/tomoshibi-hostinger.zip for Hostinger's "Upload website files" (unpacks into public_html):

    index.html, _expo/, assets/, .htaccess   the web app (players + /admin)
    api/                                     PHP API, sample song, and a ready .env to fill in

and deploy/tomoshibi.sql (all migrations in order) for phpMyAdmin → Import.

Run from the repo root:  python deploy/package_hostinger.py
The generated api/.env keeps the same JWT_SECRET across runs (stored in deploy/hostinger.env, git-ignored).
"""
import os, secrets, shutil, subprocess, sys, tempfile, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEPLOY = os.path.join(ROOT, 'deploy')
ENV_FILE = os.path.join(DEPLOY, 'hostinger.env')

if not os.path.exists(ENV_FILE):
    with open(ENV_FILE, 'w', encoding='utf8', newline='\n') as f:
        f.write(f"""# Tomoshibi API settings (becomes public_html/api/.env). Fill in the DB_* lines from hPanel → Databases.
DB_HOST=localhost
DB_PORT=3306
DB_USER=FILL_ME
DB_PASSWORD=FILL_ME
DB_NAME=FILL_ME
# Same value goes into Render → Environment → JWT_SECRET
JWT_SECRET={secrets.token_hex(32)}
# Your Render web service URL, e.g. https://tomoshibi-socket.onrender.com
SOCKET_URL=FILL_ME
# These names become admins when they register. Register one right after deploying.
ADMIN_USERNAMES=admin
CLIENT_ORIGIN=*
API_PREFIX=/api
""")

dist = tempfile.mkdtemp(prefix='tomoshibi-web-')
env = {**os.environ, 'EXPO_PUBLIC_API_URL': '/api'}   # same-origin API; the socket URL comes from /api/config
print('Building the web app...')
subprocess.run('npx expo export --platform web --output-dir "' + dist + '"', cwd=os.path.join(ROOT, 'app'), env=env, shell=True, check=True)

out = os.path.join(DEPLOY, 'tomoshibi-hostinger.zip')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(dist):
        for name in files:
            full = os.path.join(base, name)
            z.write(full, os.path.relpath(full, dist).replace('\\', '/'))
    api = os.path.join(ROOT, 'api')
    for rel in ['index.php', '.htaccess', 'uploads/.htaccess', 'uploads/sample/yoru-no-eki.json',
                'uploads/sample/yoru-no-eki.wav', 'uploads/sample/yoru-no-eki-vocal.wav']:
        z.write(os.path.join(api, rel), 'api/' + rel)
    z.write(ENV_FILE, 'api/.env')
shutil.rmtree(dist, ignore_errors=True)

with open(os.path.join(DEPLOY, 'tomoshibi.sql'), 'w', encoding='utf8', newline='\n') as f:
    for name in ['001_init.sql', '002_sample_song.sql', '003_vocal_track.sql']:
        f.write(f'-- ===== {name} =====\n' + open(os.path.join(ROOT, 'sql', name), encoding='utf8').read() + '\n')

print(f'\nWrote {out} ({os.path.getsize(out) // 1024} KB) and deploy/tomoshibi.sql')
if 'FILL_ME' in open(ENV_FILE, encoding='utf8').read():
    print('Remember: fill DB_* and SOCKET_URL in public_html/api/.env (or in deploy/hostinger.env, then re-run).')
