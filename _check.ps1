$ErrorActionPreference = 'Continue'
Set-Location 'E:\gitWarehouse\maxv\Pi-mx-Desktop'
$json = 'E:\gitWarehouse\maxv\Pi-mx-Desktop\_r.json'
$out = 'E:\gitWarehouse\maxv\Pi-mx-Desktop\_check.txt'
'=== TYPECHECK ===' | Out-File $out -Encoding utf8
npm run typecheck 2>&1 | Out-File $out -Append -Encoding utf8
'=== LINT ===' | Out-File $out -Append -Encoding utf8
npx eslint src packages/shared 2>&1 | Out-File $out -Append -Encoding utf8
'=== TESTS ===' | Out-File $out -Append -Encoding utf8
Remove-Item $json -ErrorAction SilentlyContinue
npx vitest run --reporter=json --outputFile=$json 2>&1 | Out-Null
node 'E:\gitWarehouse\maxv\Pi-mx-Desktop\_parse.mjs'
Get-Content $out | Out-Null
