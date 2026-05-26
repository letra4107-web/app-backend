$jdk = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot'
Write-Host "JDK path: $jdk"
[Environment]::SetEnvironmentVariable('JAVA_HOME', $jdk, 'User')
$oldUserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (-not $oldUserPath) { $oldUserPath = '' }
$newUserPath = "$jdk\bin;$oldUserPath"
[Environment]::SetEnvironmentVariable('PATH', $newUserPath, 'User')
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"
Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "PATH starts:"
$env:PATH -split ';' | Select-Object -First 4 | ForEach-Object { Write-Host $_ }
Write-Host '--- java -version ---'
java -version 2>&1 | ForEach-Object { Write-Host $_ }
Write-Host '--- javac -version ---'
javac -version 2>&1 | ForEach-Object { Write-Host $_ }
