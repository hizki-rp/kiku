# Renders each lyric line as Japanese speech (Microsoft Haruka) and records when every word starts.
#   powershell -ExecutionPolicy Bypass -File speak-lines.ps1 -Lyrics <song.json> -OutDir <dir>
# Writes <OutDir>/line-<n>.wav (22.05 kHz 16-bit mono) and <OutDir>/timings.json: [{ line, ms, words: [ms...] }]
param([Parameter(Mandatory)][string]$Lyrics, [Parameter(Mandatory)][string]$OutDir, [int]$Rate = -1)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$song = [System.IO.File]::ReadAllText($Lyrics, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'ja-JP' } | Select-Object -First 1
if (-not $voice) { throw 'No Japanese (ja-JP) voice installed' }
$synth.SelectVoice($voice.VoiceInfo.Name)
$synth.Rate = $Rate
$out = @()
foreach ($line in $song.lines) {
  $pb = New-Object System.Speech.Synthesis.PromptBuilder([System.Globalization.CultureInfo]::GetCultureInfo('ja-JP'))
  $i = 0
  foreach ($w in $line.words) {
    $say = if ($w.say) { $w.say } else { $w.reading }   # 'say' is precomputed in Node (particles: ha->wa, he->e)
    $pb.AppendBookmark("w$i"); $pb.AppendText($say); $i++
  }
  $pb.AppendBookmark('end')
  $marks = [System.Collections.ArrayList]::new()
  $sub = Register-ObjectEvent -InputObject $synth -EventName BookmarkReached -Action { [void]$Event.MessageData.Add(@($EventArgs.Bookmark, $EventArgs.AudioPosition.TotalMilliseconds)) } -MessageData $marks
  $wav = Join-Path $OutDir ("line-{0}.wav" -f $line.line)
  $synth.SetOutputToWaveFile($wav, $fmt)
  $synth.Speak($pb)
  $synth.SetOutputToNull()
  Start-Sleep -Milliseconds 150
  Unregister-Event -SourceIdentifier $sub.Name; Remove-Job $sub -Force
  $byName = @{}; foreach ($m in $marks) { $byName[$m[0]] = [math]::Round($m[1]) }
  $out += [pscustomobject]@{ line = $line.line; ms = $byName['end']; words = @(0..($i - 1) | ForEach-Object { $byName["w$_"] }) }
}
$synth.Dispose()
$out | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $OutDir 'timings.json')
"spoke $($out.Count) lines with $($voice.VoiceInfo.Name)"
