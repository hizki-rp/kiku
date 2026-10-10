<?php
// hPanel cron (PHP mode): wakes the Render realtime server so booths open instantly.
// Upload to ~/domains/<site>/keepalive.php — outside public_html, so it isn't reachable from the web.
// Reads SOCKET_URL from public_html/api/.env, so changing the Render URL needs no cron edit.
$url = '';
foreach (@file(__DIR__ . '/public_html/api/.env', FILE_IGNORE_NEW_LINES) ?: [] as $line) {
  if (preg_match('/^\s*SOCKET_URL\s*=\s*(\S*)/', $line, $m)) $url = $m[1];
}
if ($url === '') { echo date('c'), " SOCKET_URL not set, nothing to ping\n"; exit; }
$ch = curl_init(rtrim($url, '/') . '/');
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 20]);
$body = curl_exec($ch);
echo date('c'), " $url -> HTTP ", curl_getinfo($ch, CURLINFO_HTTP_CODE), ' ', substr((string)$body, 0, 60), "\n";
