<?php
// Tomoshibi REST API (Hostinger shared hosting). Permanent data only: users, songs, saved words.
// Dev: from the repo root run `php -S localhost:8080 api/index.php`, then hit http://localhost:8080/api/songs
declare(strict_types=1);

// .env: KEY=value lines, '#' comments. (parse_ini_file rejects '#' comments, so read it by hand.)
$ENV = [];
foreach (is_file(__DIR__ . '/.env') ? file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES) : [] as $line) {
  if (preg_match('/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/', $line, $m)) $ENV[$m[1]] = trim($m[2], "\"'");
}
function env(string $k, string $d = ''): string { global $ENV; return (string)($ENV[$k] ?? (getenv($k) ?: $d)); }

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$prefix = env('API_PREFIX', '/api');

// Built-in dev server: serve uploads ourselves so the Expo web dev server can fetch them cross-origin.
if (PHP_SAPI === 'cli-server' && str_starts_with($path, "$prefix/uploads/")) {
  $file = realpath(__DIR__ . substr($path, strlen($prefix)));
  if (!$file || !str_starts_with($file, realpath(__DIR__ . '/uploads')) || !is_file($file)) { http_response_code(404); exit; }
  $types = ['json' => 'application/json', 'mp3' => 'audio/mpeg', 'ogg' => 'audio/ogg', 'opus' => 'audio/ogg',
            'm4a' => 'audio/mp4', 'webm' => 'audio/webm', 'wav' => 'audio/wav'];
  header('Content-Type: ' . ($types[strtolower(pathinfo($file, PATHINFO_EXTENSION))] ?? 'application/octet-stream'));
  header('Access-Control-Allow-Origin: *');
  header('Accept-Ranges: bytes');   // browsers can't seek audio without range support
  $size = filesize($file); $start = 0; $end = $size - 1;
  if (preg_match('/^bytes=(\d*)-(\d*)$/', $_SERVER['HTTP_RANGE'] ?? '', $m) && ($m[1] !== '' || $m[2] !== '')) {
    if ($m[1] === '') $start = max(0, $size - (int)$m[2]);
    else { $start = (int)$m[1]; if ($m[2] !== '') $end = min((int)$m[2], $end); }
    if ($start > $end) { http_response_code(416); header("Content-Range: bytes */$size"); exit; }
    http_response_code(206);
    header("Content-Range: bytes $start-$end/$size");
  }
  header('Content-Length: ' . ($end - $start + 1));
  $f = fopen($file, 'rb'); fseek($f, $start); echo fread($f, $end - $start + 1);
  exit;
}

$origins = array_map('trim', explode(',', env('CLIENT_ORIGIN', '*')));
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array('*', $origins, true) || in_array($origin, $origins, true)) {
  header('Access-Control-Allow-Origin: ' . ($origin ?: '*'));
  header('Vary: Origin');
}
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Content-Type: application/json; charset=utf-8');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

function out($data, int $code = 200): never { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }
function fail(string $msg, int $code = 400): never { out(['error' => $msg], $code); }

set_exception_handler(function (Throwable $e) {
  error_log((string)$e);
  fail('Server error', 500);
});

function db(): PDO {
  static $pdo;
  return $pdo ??= new PDO(
    'mysql:host=' . env('DB_HOST', 'localhost') . ';port=' . env('DB_PORT', '3306') . ';dbname=' . env('DB_NAME') . ';charset=utf8mb4',
    env('DB_USER'), env('DB_PASSWORD'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
  );
}

function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function jwt_sign(array $payload): string {
  if (strlen(env('JWT_SECRET')) < 16) fail('Server not configured: set JWT_SECRET (16+ chars) in api/.env', 500);
  $h = b64u('{"alg":"HS256","typ":"JWT"}');
  $b = b64u(json_encode($payload));
  return "$h.$b." . b64u(hash_hmac('sha256', "$h.$b", env('JWT_SECRET'), true));
}
function jwt_verify(string $t): ?array {
  $p = explode('.', $t);
  if (count($p) !== 3 || env('JWT_SECRET') === '') return null;
  if (!hash_equals(b64u(hash_hmac('sha256', "$p[0].$p[1]", env('JWT_SECRET'), true)), $p[2])) return null;
  $claims = json_decode(base64_decode(strtr($p[1], '-_', '+/')), true);
  return is_array($claims) && ($claims['exp'] ?? 0) > time() ? $claims : null;
}
function auth(bool $admin = false): array {
  $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
  $claims = str_starts_with($h, 'Bearer ') ? jwt_verify(substr($h, 7)) : null;
  if (!$claims) fail('Sign in first', 401);
  if ($admin && ($claims['role'] ?? '') !== 'admin') fail('Admins only', 403);
  return $claims;
}
function session_for(array $u): array {
  // ADMIN_USERNAMES=alice,bob in .env promotes those accounts on register/login (no SQL needed on Hostinger).
  $admins = array_filter(array_map('trim', explode(',', strtolower(env('ADMIN_USERNAMES')))));
  if ($u['role'] !== 'admin' && in_array(strtolower($u['username']), $admins, true)) {
    db()->prepare("UPDATE users SET role = 'admin' WHERE id = ?")->execute([$u['id']]);
    $u['role'] = 'admin';
  }
  $user = ['id' => (int)$u['id'], 'username' => $u['username'], 'role' => $u['role']];
  return ['token' => jwt_sign(['sub' => $user['id'], 'name' => $user['username'], 'role' => $user['role'], 'exp' => time() + 30 * 86400]), 'user' => $user];
}
// PUBLIC_BASE_URL is optional: without it, file URLs are built from the request (works behind Hostinger's HTTPS proxy).
function base_url(): string {
  if (env('PUBLIC_BASE_URL') !== '') return rtrim(env('PUBLIC_BASE_URL'), '/');
  $https = ($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || ($_SERVER['SERVER_PORT'] ?? '') === '443';
  return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . env('API_PREFIX', '/api');
}
function abs_url(string $u): string { return $u === '' || preg_match('#^https?://#', $u) ? $u : base_url() . '/' . $u; }
function song_out(array $s): array {
  return ['id' => (int)$s['id'], 'title' => $s['title'], 'artist' => $s['artist'], 'level' => $s['level'],
          'audio_url' => abs_url($s['audio_url']), 'vocal_url' => abs_url($s['vocal_url'] ?? ''), 'lyrics_url' => abs_url($s['lyrics_url']),
          'duration_s' => (int)$s['duration_s'], 'published' => (bool)$s['published']];
}

// Mirrors validateLyrics() in app/src/lib/lyrics.js. Returns a list of problems (empty = valid).
function validate_lyrics($d): array {
  if (!is_array($d) || !isset($d['lines']) || !is_array($d['lines']) || !array_is_list($d['lines']) || !$d['lines']) return ['"lines" must be a non-empty array'];
  $errs = []; $prev = -1;
  $num = fn($v) => is_int($v) || is_float($v);
  $str = fn($v) => is_string($v) && trim($v) !== '';
  foreach ($d['lines'] as $i => $l) {
    $n = 'Line ' . ($i + 1);
    if (!is_array($l)) { $errs[] = "$n: must be an object"; continue; }
    if (!$num($l['start'] ?? null) || !$num($l['end'] ?? null) || $l['end'] <= $l['start']) { $errs[] = "$n: needs numeric start < end"; continue; }
    if ($l['start'] < $prev) $errs[] = "$n: starts before the previous line";
    $prev = $l['start'];
    if (!$str($l['jp'] ?? null)) $errs[] = "$n: \"jp\" is required";
    if (!is_string($l['en'] ?? null)) $errs[] = "$n: \"en\" must be a string";
    if (!is_array($l['words'] ?? null) || !array_is_list($l['words']) || !$l['words']) { $errs[] = "$n: \"words\" must be a non-empty array"; continue; }
    foreach ($l['words'] as $j => $w) {
      $wn = "$n word " . ($j + 1);
      if (!is_array($w) || !$str($w['t'] ?? null)) { $errs[] = "$wn: \"t\" is required"; continue; }
      foreach (['reading', 'romaji', 'meaning'] as $k) if (!$str($w[$k] ?? null)) $errs[] = "$wn ($w[t]): \"$k\" is required";
      if (isset($w['note']) && !is_string($w['note'])) $errs[] = "$wn: \"note\" must be a string";
      if (isset($w['start']) && (!$num($w['start']) || $w['start'] < $l['start'] || $w['start'] >= $l['end'])) $errs[] = "$wn: \"start\" must be inside the line";
    }
  }
  return $errs;
}

function body(): array {
  $j = json_decode(file_get_contents('php://input') ?: '', true);
  return is_array($j) ? $j : $_POST;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$route = '/' . trim(str_starts_with($path, $prefix) ? substr($path, strlen($prefix)) : $path, '/');

// ---- auth ----
if ($route === '/auth/register' && $method === 'POST') {
  $b = body();
  $name = trim((string)($b['username'] ?? '')); $pw = (string)($b['password'] ?? '');
  if (!preg_match('/^[A-Za-z0-9_]{3,24}$/', $name)) fail('Username: 3-24 letters, numbers or _');
  if (strlen($pw) < 6) fail('Password: at least 6 characters');
  $st = db()->prepare('SELECT id FROM users WHERE username = ?'); $st->execute([$name]);
  if ($st->fetch()) fail('That name is taken', 409);
  db()->prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')->execute([$name, password_hash($pw, PASSWORD_DEFAULT)]);
  out(session_for(['id' => db()->lastInsertId(), 'username' => $name, 'role' => 'user']));
}
if ($route === '/auth/login' && $method === 'POST') {
  $b = body();
  $st = db()->prepare('SELECT * FROM users WHERE username = ?'); $st->execute([trim((string)($b['username'] ?? ''))]);
  $u = $st->fetch();
  if (!$u || !password_verify((string)($b['password'] ?? ''), $u['password_hash'])) fail('Wrong name or password', 401);
  out(session_for($u));
}

// ---- songs ----
if ($route === '/songs' && $method === 'GET') {
  $all = isset($_GET['all']) && auth(true);
  $rows = db()->query('SELECT * FROM songs' . ($all ? '' : ' WHERE published = 1') . ' ORDER BY created_at DESC')->fetchAll();
  out(array_map('song_out', $rows));
}
if ($route === '/admin/songs' && $method === 'POST') {
  auth(true);
  $id = (int)($_POST['id'] ?? 0);
  $title = trim((string)($_POST['title'] ?? ''));
  $level = (string)($_POST['level'] ?? 'N5');
  if ($title === '' || mb_strlen($title) > 120) fail('Title is required (max 120)');
  if (!in_array($level, ['N5', 'N4', 'N3', 'N2', 'N1'], true)) fail('Bad level');

  $lyrics = null;
  if (isset($_POST['lyrics']) && $_POST['lyrics'] !== '') {
    $lyrics = json_decode((string)$_POST['lyrics'], true);
    if ($lyrics === null) fail('Lyrics are not valid JSON');
    if ($errs = validate_lyrics($lyrics)) out(['error' => 'Lyrics JSON has problems', 'details' => $errs], 422);
  }
  // audio = karaoke track (no vocals, used in booths); vocal = original with vocals (Songbook listening / training)
  $files = [];
  foreach (['audio' => 'Karaoke track', 'vocal' => 'Vocal track'] as $field => $label) {
    $f = $_FILES[$field] ?? null;
    if (!$f || $f['error'] === UPLOAD_ERR_NO_FILE) continue;
    if ($f['error'] !== UPLOAD_ERR_OK) fail("$label upload failed (too big for the server?)");
    if ($f['size'] > 3 * 1024 * 1024) fail("$label must be 3 MB or less (64 kbps MP3/Opus)");
    $ext = strtolower(pathinfo((string)$f['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ['mp3', 'ogg', 'opus', 'm4a', 'webm', 'wav'], true)) fail("$label must be mp3, ogg/opus, m4a or webm");
    $files[$field] = [$f, $ext];
  }
  if (!$id && (!isset($files['audio']) || !$lyrics)) fail('New songs need a karaoke track and lyrics');

  $fields = [$title, trim((string)($_POST['artist'] ?? '')), $level, max(0, min(1800, (int)($_POST['duration_s'] ?? 0))), (int)!empty($_POST['published'])];
  if ($id) {
    $st = db()->prepare('UPDATE songs SET title = ?, artist = ?, level = ?, duration_s = ?, published = ? WHERE id = ?');
    $st->execute([...$fields, $id]);
    $chk = db()->prepare('SELECT id FROM songs WHERE id = ?'); $chk->execute([$id]);
    if (!$chk->fetch()) fail('Song not found', 404);
  } else {
    db()->prepare('INSERT INTO songs (title, artist, level, duration_s, published) VALUES (?, ?, ?, ?, ?)')->execute($fields);
    $id = (int)db()->lastInsertId();
  }
  $v = time();
  foreach ($files as $field => [$f, $ext]) {
    @mkdir(__DIR__ . '/uploads/audio', 0755, true);
    $rel = "uploads/audio/$id-$field-$v.$ext";
    if (!move_uploaded_file($f['tmp_name'], __DIR__ . "/$rel")) fail('Could not store audio', 500);
    $col = $field === 'vocal' ? 'vocal_url' : 'audio_url';
    db()->prepare("UPDATE songs SET $col = ? WHERE id = ?")->execute([$rel, $id]);
  }
  if ($lyrics) {
    @mkdir(__DIR__ . '/uploads/lyrics', 0755, true);
    $lyrics['songId'] = $id;
    file_put_contents(__DIR__ . "/uploads/lyrics/$id.json", json_encode($lyrics, JSON_UNESCAPED_UNICODE));
    db()->prepare('UPDATE songs SET lyrics_url = ? WHERE id = ?')->execute(["uploads/lyrics/$id.json?v=$v", $id]);
  }
  $st = db()->prepare('SELECT * FROM songs WHERE id = ?'); $st->execute([$id]);
  out(song_out($st->fetch()));
}

// ---- saved words ----
if ($route === '/words') {
  $me = (int)auth()['sub'];
  if ($method === 'GET') {
    $st = db()->prepare('SELECT * FROM saved_words WHERE user_id = ? ORDER BY known ASC, created_at DESC'); $st->execute([$me]);
    out(array_map(fn($w) => [...$w, 'id' => (int)$w['id'], 'known' => (bool)$w['known'], 'song_id' => $w['song_id'] === null ? null : (int)$w['song_id']], $st->fetchAll()));
  }
  if ($method === 'POST') {
    // One word, or a whole song's vocabulary pack: { "words": [ {...}, ... ] }
    $b = body();
    $list = isset($b['words']) && is_array($b['words']) ? array_slice($b['words'], 0, 300) : [$b];
    $st = db()->prepare('INSERT INTO saved_words (user_id, song_id, word, reading, romaji, meaning, line_jp, line_en, booth_name)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE meaning = VALUES(meaning), line_jp = VALUES(line_jp), line_en = VALUES(line_en)');
    $saved = 0;
    foreach ($list as $w) {
      if (!is_array($w)) continue;
      $s = fn($k, $max) => mb_substr(trim((string)($w[$k] ?? '')), 0, $max);
      if ($s('word', 64) === '') continue;
      $st->execute([$me, (int)($w['song_id'] ?? 0) ?: null, $s('word', 64), $s('reading', 64), $s('romaji', 64), $s('meaning', 255), $s('line_jp', 255), $s('line_en', 255), $s('booth_name', 64)]);
      $saved++;
    }
    if (!$saved) fail('Word is required');
    out(['ok' => true, 'saved' => $saved]);
  }
}
if (preg_match('#^/words/(\d+)$#', $route, $m)) {
  $me = (int)auth()['sub'];
  if ($method === 'PATCH') {
    db()->prepare('UPDATE saved_words SET known = ? WHERE id = ? AND user_id = ?')->execute([(int)!empty(body()['known']), (int)$m[1], $me]);
    out(['ok' => true]);
  }
  if ($method === 'DELETE') {
    db()->prepare('DELETE FROM saved_words WHERE id = ? AND user_id = ?')->execute([(int)$m[1], $me]);
    out(['ok' => true]);
  }
}

if ($route === '/' || $route === '/health') out(['ok' => true]);
if ($route === '/config') out(['socket_url' => env('SOCKET_URL')]);   // public: where the realtime server lives
fail('Not found', 404);
