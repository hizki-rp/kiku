-- Songs get two tracks: audio_url = karaoke (no vocals, used in booths),
-- vocal_url = original with vocals (for listening / training in the Songbook).
SET NAMES utf8mb4;
ALTER TABLE songs ADD COLUMN vocal_url VARCHAR(512) NOT NULL DEFAULT '' AFTER audio_url;
UPDATE songs SET vocal_url = 'uploads/sample/yoru-no-eki-vocal.wav' WHERE audio_url = 'uploads/sample/yoru-no-eki.wav';
