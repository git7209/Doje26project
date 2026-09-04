$ErrorActionPreference = "Stop"

$serviceName = "postgresql-x64-18"
$pgHba = "C:\Program Files\PostgreSQL\18\data\pg_hba.conf"
$backup = "C:\Users\deok7\LxcProgramMade\tools\pg_hba.conf.wsl-backup"
$resultFile = "C:\Users\deok7\LxcProgramMade\tools\postgres-wsl-result.txt"
$subnet = "172.25.221.169/32"
$ruleName = "LXC Console PostgreSQL from WSL"

Copy-Item -LiteralPath $pgHba -Destination $backup -Force
try {
  $content = [IO.File]::ReadAllText($pgHba)
  $rule = "host    all             all             $subnet          scram-sha-256"
  if (-not $content.Contains($rule)) {
    $content = $content.TrimEnd() + [Environment]::NewLine + $rule + [Environment]::NewLine
    [IO.File]::WriteAllText($pgHba, $content, [Text.UTF8Encoding]::new($false))
  }
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5432 -RemoteAddress $subnet | Out-Null
  Restart-Service -Name $serviceName
  Set-Content -LiteralPath $resultFile -Value "POSTGRES_WSL_ACCESS_OK" -Encoding utf8
}
catch {
  Copy-Item -LiteralPath $backup -Destination $pgHba -Force
  Restart-Service -Name $serviceName -ErrorAction SilentlyContinue
  Set-Content -LiteralPath $resultFile -Value ("POSTGRES_WSL_ACCESS_FAILED: " + $_.Exception.Message) -Encoding utf8
  throw
}
