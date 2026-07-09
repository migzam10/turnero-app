# Descarga el binario Piper (TTS neuronal) + un modelo de voz en español a vendor\tts\.
# Deja listas las rutas para PIPER_BIN / PIPER_MODEL.
# Alternativa sin descargar nada en Windows: usar TTS_ENGINE=sapi (voces del SO).
#
# Uso (PowerShell):
#   .\scripts\setup-tts.ps1                       # descarga la voz por defecto (sharvard)
#   .\scripts\setup-tts.ps1 es_AR-daniela-high    # descarga otra voz de la lista
#   .\scripts\setup-tts.ps1 list                  # solo muestra las voces disponibles
#
# ── Voces en español disponibles (Piper) ─────────────────────────────
#   Espana (es_ES):
#     es_ES-sharvard-medium   multi-voz: 0=hombre, 1=mujer  (por defecto; usa PIPER_SPEAKER)
#     es_ES-davefx-medium     hombre
#     es_ES-carlfm-x_low      hombre (calidad baja, mas liviano)
#     es_ES-mls_9972-low      hombre (calidad baja)
#     es_ES-mls_10246-low     hombre (calidad baja)
#   Mexico (es_MX):
#     es_MX-claude-high       mujer (alta calidad)
#     es_MX-ald-medium        hombre
#   Argentina (es_AR):
#     es_AR-daniela-high      mujer (alta calidad)
# ─────────────────────────────────────────────────────────────────────
param([string]$Voz = 'es_ES-sharvard-medium')
$ErrorActionPreference = 'Stop'

if ($Voz -eq 'list' -or $Voz -eq '--list') {
    $show = $false
    foreach ($line in Get-Content $PSCommandPath) {
        if ($line -match '^# ── Voces') { $show = $true; continue }
        if ($show -and $line -match '^# ─') { break }
        if ($show) { $line -replace '^# ?', '' }
    }
    exit 0
}

$Raiz    = Split-Path -Parent $PSScriptRoot
$Dest    = Join-Path $Raiz 'vendor\tts'
$Modelos = Join-Path $Dest 'models'
$PiperVer = '2023.11.14-2'
$PiperUrl = "https://github.com/rhasspy/piper/releases/download/$PiperVer/piper_windows_amd64.zip"

# La ruta en HuggingFace se deriva del id de la voz: es_ES-sharvard-medium -> es/es_ES/sharvard/medium
$p = $Voz -split '-'
$Locale = $p[0]; $Name = $p[1]; $Quality = $p[2]
$Lang = $Locale.Split('_')[0]
$ModelBase = "https://huggingface.co/rhasspy/piper-voices/resolve/main/$Lang/$Locale/$Name/$Quality"
$ModelFile = "$Voz.onnx"

New-Item -ItemType Directory -Force -Path $Dest, $Modelos | Out-Null

Write-Host "==> Descargando Piper ($PiperVer)…"
$zip = Join-Path $Dest 'piper.zip'
Invoke-WebRequest -Uri $PiperUrl -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $Dest -Force   # crea $Dest\piper\piper.exe
Remove-Item $zip

Write-Host "==> Descargando modelo de voz ($ModelFile)…"
Invoke-WebRequest -Uri "$ModelBase/$ModelFile"      -OutFile (Join-Path $Modelos $ModelFile)
Invoke-WebRequest -Uri "$ModelBase/$ModelFile.json" -OutFile (Join-Path $Modelos "$ModelFile.json")

Write-Host ""
Write-Host "Listo. Anade a tu .env:"
Write-Host "  TTS_ENGINE=piper"
Write-Host "  PIPER_BIN=$Dest\piper\piper.exe"
Write-Host "  PIPER_MODEL=$Modelos\$ModelFile"
if ($Name -eq 'sharvard') {
    Write-Host "  PIPER_SPEAKER=1          # sharvard tiene 2 voces; la 1 es la femenina"
}
Write-Host "  PIPER_LENGTH_SCALE=1.25  # ritmo (mayor = mas lento)"
Write-Host "  PIPER_SENTENCE_SILENCE=0.4"
