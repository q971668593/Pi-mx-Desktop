$ErrorActionPreference = 'Continue'
Set-Location 'E:\gitWarehouse\maxv\Pi-mx-Desktop'
$full = 'E:\gitWarehouse\maxv\Pi-mx-Desktop\_full.txt'
$out = 'E:\gitWarehouse\maxv\Pi-mx-Desktop\_check.txt'
$lines = Get-Content $full
$keep = $lines | Where-Object { $_ -match '^\s*(FAIL|Test Files|Tests|Duration|Start at)\b' }
$keep | Out-File $out -Encoding utf8
('TOTAL LINES: ' + $lines.Count) | Out-File $out -Append -Encoding utf8
'=== DONE ===' | Out-File $out -Append -Encoding utf8
