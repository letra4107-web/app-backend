$old = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (-not $old) { $old = '' }
$jdk = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
$new = "$jdk\bin;" + $old
[Environment]::SetEnvironmentVariable('PATH', $new, 'User')
Write-Host "Saved user PATH length=$($new.Length)"
Write-Host "PATH starts:"
$new -split ';' | Select-Object -First 4 | ForEach-Object { Write-Host $_ }
