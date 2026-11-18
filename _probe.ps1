$ErrorActionPreference = 'Continue'
$root = 'E:\gitWarehouse\maxv\Pi-mx-Desktop'
$out = Join-Path $root '_probe.txt'
$lines = @()
$lines += '### TEST FILES WITH CJK STRINGS'
$files = Get-ChildItem (Join-Path $root 'src') -Recurse -File -Include *.test.ts,*.test.tsx
foreach ($f in $files) {
  $text = Get-Content -Raw -Encoding utf8 $f.FullName
  if ($text -match '[\u4e00-\u9fff]') {
    $lines += $f.FullName.Replace($root + '\', '')
  }
}
$lines += ''
$lines += '### TEST FILE COUNT'
$lines += $files.Count
$lines | Out-File -FilePath $out -Encoding utf8
'done'
