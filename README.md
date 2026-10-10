# Tomoshibi (ともしび)

A small live karaoke app for learning Japanese. You join a booth, sing along to synced lyrics with furigana, talk over voice chat, tap any word to see what it means, and save words to flashcards.

- **Songbook:** listen alone first. "With vocals" plays the original so you can learn it. "Karaoke" plays the backing track only. Each song comes with a vocabulary pack (every word in it) that you can save to your flashcards with one tap.
- **Booths:** use the karaoke track. Pressing **Sing next** queues you and opens your microphone. Everyone in the booth can join voice chat with the headphones button, mute and unmute, or long-press to leave voice. Disco lights run while a song plays.

| Folder | What it is | Where it runs |
|---|---|---|
| `app/` | Expo (React Native + web) client. The admin songbook is at `/admin` on web. | Phones (Expo / EAS), web build on Hostinger |
| `api/` | PHP REST API: auth (JWT), songs, saved words, admin uploads | Hostinger shared hosting |
| `server/` | Node + Socket.IO. Holds all live state (booths, knocks, queue, now playing, chat) in memory. | Render free tier |
| `sql/` | MySQL migrations and the sample song seed | Hostinger MySQL |
| `design-export/` | The design mockup (visual source of truth) | — |

**How the pieces talk to each other.** The PHP API is the only thing that touches MySQL, and it signs JWTs. The Render server checks those JWTs with the same `JWT_SECRET` and never connects to the database, so you don't need Remote MySQL and Render's changing IPs don't matter. Chat, presence and the queue are never written to MySQL.

**How lyrics stay in sync.** When a song starts, the server broadcasts `{ songId, startedAt }` once. `startedAt` is set 1.5 s in the future so every phone has time to load. Each client pings `time_sync` on connect to work out its clock offset, downloads the audio and lyrics JSON from Hostinger, seeks to the right position, and re-checks drift every second. The word highlight follows `audio.currentTime`. If the audio is blocked or still loading, it falls back to the shared clock.

## Local development

You need Node 20+, PHP 8.1+ with `pdo_mysql`, and MySQL or MariaDB (XAMPP works).

```bash
# 1. Database
mysql -uroot -e "CREATE DATABASE tomoshibi CHARACTER SET utf8mb4"
mysql -uroot tomoshibi < sql/001_init.sql
mysql -uroot tomoshibi < sql/002_sample_song.sql
mysql -uroot tomoshibi < sql/003_vocal_track.sql
node content/demo-songs/make-audio.js  # (Windows, needs a Japanese voice) re-voices the demo + sample songs and re-times their lyrics

# 2. PHP API on :8080, run from the repo root
cp api/.env.example api/.env           # set DB_*, JWT_SECRET, PUBLIC_BASE_URL=http://localhost:8080/api, CLIENT_ORIGIN=*
php -S localhost:8080 api/index.php

# 3. Socket server on :3001
cd server && npm install && cp .env.example .env   # same JWT_SECRET as api/.env, CLIENT_ORIGIN=*
npm run dev

# 4. App
cd app && npm install && cp .env.example .env      # EXPO_PUBLIC_API_URL=http://localhost:8080/api, EXPO_PUBLIC_SOCKET_URL=http://localhost:3001
npx expo start                         # press w for web, or scan the QR code with Expo Go
```

On a real phone, replace `localhost` in `app/.env` with your computer's LAN IP.

**Admin account:** put your username in `ADMIN_USERNAMES` in `api/.env` (comma-separated), then register that name in the app. It becomes an admin when it registers or logs in, so you don't need any SQL. Register it right after deploying, so nobody else can take the name first.

**Testing through Apache instead of `php -S`:** with XAMPP, run `mklink /J C:\xampp\htdocs\tomoshibi-api C:\path\to\repo\api` and set `API_PREFIX=/tomoshibi-api` and `PUBLIC_BASE_URL=http://localhost/tomoshibi-api`. This exercises the same `.htaccess` that Hostinger uses.

**Voice chat locally:** browsers only allow the microphone on `localhost` or HTTPS. To test with friends on other devices, deploy (Hostinger gives you HTTPS) or tunnel port 8081.

Tests (no framework):

```bash
cd server && npm test     # knock → admit → chat → queue → host-only guards → close
cd app && npm test        # lyric timing + JSON validation (also validates the sample song)
```

## Deploy

### 1. Hostinger MySQL
1. In hPanel, go to **Databases → MySQL Databases** and create a database and user.
2. Open **phpMyAdmin**, select the database, and import `sql/001_init.sql`, `sql/002_sample_song.sql` and `sql/003_vocal_track.sql`, in that order.

You don't need **Remote MySQL**: only PHP on the same host connects. If you later want Render to read the database directly, add Render's outbound IPs under **Databases → Remote MySQL**, use the remote hostname hPanel shows, and keep `connectionLimit` at 5 or less.

### Quick path: one zip for Hostinger
Run `python deploy/package_hostinger.py`. It writes three files:
- `deploy/tomoshibi-hostinger.zip`: the web app and the API, laid out as `public_html` expects
- `deploy/tomoshibi.sql`: all migrations in order
- `deploy/hostinger.env`: becomes `api/.env`, with a generated `JWT_SECRET`

In hPanel, choose **Upload website files** and upload the zip. Import the `.sql` file in phpMyAdmin, then fill in the `DB_*` and `SOCKET_URL` lines in `public_html/api/.env`. The web app calls `/api` on the same domain, and the apps get the socket address from `/api/config`, so neither needs your domain or Render URL built in. Steps 2 and 4 below are the manual version of this.

### 2. Hostinger PHP API
1. Upload `api/` to `public_html/api/`. Include `.htaccess`, `uploads/.htaccess` and `uploads/sample/`.
2. Create `public_html/api/.env` from `api/.env.example`. Generate `JWT_SECRET` with `openssl rand -hex 32` and set `ADMIN_USERNAMES`.
3. Check that `https://your-domain/api/health` returns `{"ok":true}`.
4. Audio uploads are capped at 3 MB. If PHP rejects them, raise `upload_max_filesize` and `post_max_size` to 8M under **Advanced → PHP Configuration**.

### 3. Render socket server
1. Push the repo to GitHub, then in Render choose **New → Blueprint** and select the repo. It reads `render.yaml`. You can also create a Web Service by hand with root dir `server`, start command `node server.js`, and the free plan.
2. Set `JWT_SECRET` (identical to the PHP one) and `CLIENT_ORIGIN` (your web app URL, or `*` while testing).
3. Free instances sleep after about 15 minutes idle and take up to a minute to wake. The app shows "Lighting the lamp…" during that time and retries with backoff. All live booths are lost when the instance sleeps or restarts. That's by design: nothing live is persistent.

### 4. Web app on Hostinger
```bash
cd app && cp .env.example .env   # set production API + socket URLs
npx expo export --platform web   # outputs app/dist (includes the SPA .htaccess from app/public)
```
Upload the contents of `app/dist/` to `public_html/` (or a subdomain). The admin songbook is at `https://your-domain/admin`.

The site must use **HTTPS**, because browsers block the microphone on plain HTTP; enable the free SSL in hPanel. Voice audio travels directly between people, and Render only relays the connection set-up. That keeps costs at zero, but people on strict networks (some mobile carriers, office Wi-Fi) need a TURN relay. If someone can see the booth but nobody can hear them, set the `EXPO_PUBLIC_TURN_*` values in `app/.env` (a free metered.ca account works) and rebuild. A voice group holds up to 8 people.

### 5. Android APK (what testers install)
Deploy steps 1–4 first. The APK talks to your live servers, and Android blocks plain `http://`, so both URLs must be HTTPS.

1. Put your real URLs in `app/eas.json` → `build.preview.env` (`EXPO_PUBLIC_API_URL=https://your-domain/api`, `EXPO_PUBLIC_SOCKET_URL=https://your-service.onrender.com`). EAS builds don't read `app/.env`, because it's git-ignored. Add the `EXPO_PUBLIC_TURN_*` values here too if you use TURN.
2. Build in Expo's cloud (free tier). The first run asks you to log in and links the project:
   ```bash
   cd app
   npx eas-cli@latest login
   npx eas-cli@latest build -p android --profile preview
   ```
   After about 10–20 minutes you get a link and QR code to an `.apk`. Share that link. Testers open it on Android and allow "install unknown apps".
3. **Shipping a new version:** bump `expo.android.versionCode` in `app.json`, then build again. Testers install over the old one, and their login and saved words are kept.

Notes:
- **Voice chat in the APK** uses `react-native-webrtc`. Voice plays through the loudspeaker, or headphones/Bluetooth when connected. Headphones stop the karaoke track from echoing into the mic. Android asks for microphone permission the first time someone joins voice or presses Sing next.
- **Expo Go** can't load native WebRTC. It's fine for quick UI checks (`npx expo start`, scan the QR code), but voice says it needs the app.
- **Admins** add songs on the web version at `/admin`, not in the APK.
- **iOS** would be `-p ios` with an Apple developer account.

## Songs and lyrics

To add a song as an admin, open `/admin` → **New song**. Upload two tracks, each MP3/Opus at 64 kbps or less and 3 MB max: the **karaoke track** (no vocals, required, used in booths) and the **vocal track** (the original, for learning in the Songbook). The duration is read automatically. Then paste or load the lyrics JSON; its word map is the song's vocabulary pack, so give every word a reading, romaji, meaning and a short note. Check each line in the word-map editor and preview, then click **Publish**. The JSON is validated in the browser and again in PHP.

```json
{ "songId": 1, "lines": [ { "line": 1, "start": 12.4, "end": 16.8,
  "jp": "夜の駅で 君を待つ", "en": "At the night station, I wait for you",
  "words": [ { "t": "夜", "reading": "よる", "romaji": "yoru", "meaning": "night", "note": "Noun." } ] } ] }
```

The line's duration is split evenly across its words. Give a word its own `"start"` (in seconds, inside the line) to override that.

The sample song `夜の駅で` was written for this project. Its audio (`api/uploads/sample/yoru-no-eki.wav`) is a generated placeholder melody. Swap in a real recording when you have one.

## Socket events

Client → server (every call takes an ack callback that returns `{ error }` on failure): `time_sync`, `list_rooms`, `create_room`, `request_entry`, `cancel_entry`, `approve_entry`*, `decline_entry`*, `remove_member`*, `leave_room`, `chat_message`, `reaction`, `join_queue`, `leave_queue`, `voice_join`, `voice_leave`, `voice_mute`, `voice_signal`, `pause_song`*, `resume_song`*, `skip_song`*, `set_knock_required`*, `close_room`*.
\* = host only, checked on the server.

Server → client: `rooms_updated`, `room_state`, `user_list_updated`, `admission_requested` (host only), `entry_approved`, `entry_declined`, `removed`, `chat_message`, `reaction`, `song_started`, `song_paused`, `song_skipped`, `voice_signal`, `voice_left`, `room_closed`.

If someone's connection drops, the server holds their seat for 30 s so they can reconnect. If the host leaves, the person who has been inside longest becomes host. A booth closes when the last person leaves.
