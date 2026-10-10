-- Tomoshibi schema. Run once in Hostinger phpMyAdmin (or `mysql < 001_init.sql`).
-- Only permanent data lives here. Chat, presence, queue and rooms stay in socket-server memory.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(32)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('user','admin') NOT NULL DEFAULT 'user',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS songs (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(120) NOT NULL,
  artist      VARCHAR(120) NOT NULL DEFAULT '',
  level       ENUM('N5','N4','N3','N2','N1') NOT NULL DEFAULT 'N5',
  audio_url   VARCHAR(512) NOT NULL DEFAULT '',
  lyrics_url  VARCHAR(512) NOT NULL DEFAULT '',
  duration_s  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  published   TINYINT(1) NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_words (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  song_id     INT UNSIGNED NULL,
  word        VARCHAR(64)  NOT NULL,
  reading     VARCHAR(64)  NOT NULL DEFAULT '',
  romaji      VARCHAR(64)  NOT NULL DEFAULT '',
  meaning     VARCHAR(255) NOT NULL DEFAULT '',
  line_jp     VARCHAR(255) NOT NULL DEFAULT '',
  line_en     VARCHAR(255) NOT NULL DEFAULT '',
  booth_name  VARCHAR(64)  NOT NULL DEFAULT '',
  known       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_word (user_id, word),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
