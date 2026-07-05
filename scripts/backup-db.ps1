# Backup de la BD del turnero (Windows Server). Programar en Task Scheduler.
# Uso:
#   .\backup-db.ps1                          # BD en Docker (contenedor turnero_db)
#   .\backup-db.ps1 -Modo nativo             # PostgreSQL instalado en Windows
#   .\backup-db.ps1 -Destino "D:\backups"
#
# Restaurar un backup:
#   pg_restore -U turnero_user -d turnero --clean archivo.dump
#   (en Docker: docker exec -i turnero_db pg_restore -U turnero_user -d turnero --clean < archivo.dump)
param(
    [string]$Destino = "$PSScriptRoot\..\backups",
    [ValidateSet('docker','nativo')][string]$Modo = 'docker',
    [string]$PgDump = 'C:\Program Files\PostgreSQL\16\bin\pg_dump.exe'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Destino | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$archivo = Join-Path $Destino "turnero_$stamp.dump"
if ($Modo -eq 'docker') {
    docker exec turnero_db pg_dump -U turnero_user -d turnero --format=custom > $archivo
} else {
    $env:PGPASSWORD = (Get-Content "$PSScriptRoot\..\.env" | Where-Object { $_ -match '^DB_PASSWORD=' }) -replace '^DB_PASSWORD=',''
    & $PgDump -h localhost -U turnero_user -d turnero --format=custom -f $archivo
}
if ((Get-Item $archivo).Length -eq 0) { throw "Backup vacío: $archivo" }
# Retención: conserva los últimos 30
Get-ChildItem $Destino -Filter 'turnero_*.dump' | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 30 | Remove-Item
Write-Host "[backup] OK -> $archivo"
