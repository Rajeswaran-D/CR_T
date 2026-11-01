# LOCAL-ONLY MySQL bootstrap: grants admin access to the local instance so the
# approved local DB (circor_e2e_dev) + user (cft_app) can be provisioned.
# - Runs entirely against 127.0.0.1. Never touches remote/production hosts.
# - Contains NO secrets. Reads the app password from the repo .env at runtime;
#   generates a root password and stores it as MYSQL_ROOT_PASSWORD in .env
#   (git-ignored). Passwords are never echoed to output.
param()
$ErrorActionPreference = 'Stop'
$marker = Join-Path $env:TEMP 'circor_mysql_bootstrap_status.txt'
$repoEnv = 'c:\Users\gmh08\OneDrive\Pictures\Desktop\Shine\CA\.env'
$bin = 'C:\Program Files\MySQL\MySQL Server 9.7\bin'
$myIni = 'C:\ProgramData\MySQL\MySQL Server 9.7\my.ini'
$tmpDb = Join-Path $env:TEMP ('circor_tmpdb_' + [guid]::NewGuid().ToString('N') + '.sql')

function Fail([string]$m) {
    # Always bring the real service back before reporting failure.
    try { Get-Process mysqld -ErrorAction SilentlyContinue | Stop-Process -Force } catch {}
    Start-Sleep -Seconds 2
    try { Start-Service MySQL97 } catch {}
    Set-Content -Path $marker -Value "FAIL: $m"
    exit 1
}
$tdErr = Join-Path $env:TEMP 'circor_tmp_mysqld_err.txt'
$tdOut = Join-Path $env:TEMP 'circor_tmp_mysqld_out.txt'
Remove-Item $tdErr, $tdOut -ErrorAction SilentlyContinue
try {
    Stop-Service MySQL97 -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3

    # Temp server with grant tables disabled so we can re-provision local accounts.
    $p = Start-Process -FilePath "$bin\mysqld.exe" `
        -ArgumentList "`"--defaults-file=$myIni`"", '--skip-grant-tables', '--console' `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardError $tdErr -RedirectStandardOutput $tdOut
    $up = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 3306); $c.Close(); $up = $true; break } catch {}
    }
    if (-not $up) {
        $tail = ''
        if (Test-Path $tdErr) { $tail += (Get-Content $tdErr -Raw -ErrorAction SilentlyContinue) }
        if (Test-Path $tdOut) { $tail += (Get-Content $tdOut -Raw -ErrorAction SilentlyContinue) }
        $tail = ($tail -split "`n" | Select-Object -Last 8) -join ' | '
        Fail "temp mysqld (skip-grant-tables) did not come up — mysqld said: $tail"
    }

    # Read app password from repo .env (never printed).
    $appPw = ((Get-Content $repoEnv | Where-Object { $_ -match '^MYSQL_PASSWORD=' }) -replace '^MYSQL_PASSWORD=', '').Trim()
    if (-not $appPw) { Fail 'MYSQL_PASSWORD missing in repo .env' }
    $rootPw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 28 | ForEach-Object { [char]$_ })

    $q = {
        param($rp, $ap)
        @"
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY '$rp';
CREATE USER IF NOT EXISTS 'cft_app'@'localhost' IDENTIFIED BY '$ap';
CREATE USER IF NOT EXISTS 'cft_app'@'%' IDENTIFIED BY '$ap';
CREATE DATABASE IF NOT EXISTS circor_e2e_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON circor_e2e_dev.* TO 'cft_app'@'localhost';
GRANT ALL PRIVILEGES ON circor_e2e_dev.* TO 'cft_app'@'%';
FLUSH PRIVILEGES;
SELECT 'BOOTSTRAP_OK' AS result;
"@
    }
    $sql = & $q $rootPw ($appPw.Replace("'", "''"))
    [IO.File]::WriteAllText($tmpDb, $sql)   # UTF-8 without BOM (mysql client friendly)
    $env:MYSQL_PWD = ''   # server ignores auth while skip-grant-tables is active
    $out = Get-Content $tmpDb -Raw | & "$bin\mysql.exe" -h 127.0.0.1 -P 3306 -u root --default-character-set=utf8mb4 2>&1 | Out-String
    Remove-Item $tmpDb -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0 -or $out -notmatch 'BOOTSTRAP_OK') { Fail "grant setup failed: $out" }

    # Persist root password for future local admin use (git-ignored .env only).
    if (Select-String -Path $repoEnv -Pattern '^MYSQL_ROOT_PASSWORD=' -Quiet) {
        (Get-Content $repoEnv) -replace '^MYSQL_ROOT_PASSWORD=.*', "MYSQL_ROOT_PASSWORD=$rootPw" | Set-Content $repoEnv -Encoding UTF8
    } else {
        Add-Content -Path $repoEnv -Value "MYSQL_ROOT_PASSWORD=$rootPw" -Encoding UTF8
    }

    # Restore the real server.
    taskkill /IM mysqld.exe /F 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    Start-Service MySQL97
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 3306); $c.Close(); break } catch {}
    }
    if ((Get-Service MySQL97).Status -ne 'Running') { Fail 'service did not restart' }

    # Apply the repo schema (CREATE TABLE only — verified: no DROP/TRUNCATE/DELETE
    # statements) to the fresh local database, as the application user.
    $schema = 'c:\Users\gmh08\OneDrive\Pictures\Desktop\Shine\CA\database\mysql-schema.sql'
    $env:MYSQL_PWD = $appPw
    $schemaOut = Get-Content $schema -Raw | & "$bin\mysql.exe" -h 127.0.0.1 -P 3306 -u cft_app --default-character-set=utf8mb4 circor_e2e_dev 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Fail "schema import failed: $schemaOut" }
    Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue

    Set-Content -Path $marker -Value 'OK: grants provisioned; schema applied; service running on 127.0.0.1:3306'
} catch {
    # Ensure service is back even on failure.
    try { taskkill /IM mysqld.exe /F 2>&1 | Out-Null } catch {}
    try { Start-Service MySQL97 } catch {}
    Fail $_.Exception.Message
}