-- Original sample song for testing (lyrics written for this project, no copyright issues).
-- Files live in api/uploads/sample/. Paths are relative; the API prefixes PUBLIC_BASE_URL.
SET NAMES utf8mb4;
INSERT INTO songs (title, artist, level, audio_url, lyrics_url, duration_s, published)
VALUES ('夜の駅で (Yoru no Eki de)', 'Tomoshibi House Band', 'N5',
        'uploads/sample/yoru-no-eki.wav', 'uploads/sample/yoru-no-eki.json', 48, 1);
-- Make yourself admin after registering in the app:
-- UPDATE users SET role = 'admin' WHERE username = 'your-name';
