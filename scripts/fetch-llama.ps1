# Baixa o build Vulkan (Windows) do llama.cpp e instala em
# src-tauri/binaries/llama (llama-server.exe + DLLs do ggml).
# Assets do Windows são .zip; o Linux/AppImage usa o .tar.gz (fetch-llama.sh).
#
# Robustez: a release "latest" do llama.cpp fica incompleta por um tempo (os
# assets sobem aos poucos; às vezes um build nunca sobe) — por isso varremos as
# últimas releases e usamos a PRIMEIRA que tem o asset Vulkan de Windows.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/fetch-llama.ps1
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot
$llamaDir = Join-Path $root "src-tauri\binaries\llama"
New-Item -ItemType Directory -Force -Path $llamaDir | Out-Null

if (Test-Path (Join-Path $llamaDir "llama-server.exe")) {
    Write-Host "llama runtime já existe em $llamaDir"
    exit 0
}

Write-Host "Consultando releases recentes do llama.cpp..."
$headers = @{ "User-Agent" = "localagenda-app" }
if ($env:GH_TOKEN) { $headers["Authorization"] = "Bearer $env:GH_TOKEN" }

$asset = $null
$tag = ""
foreach ($attempt in 1..3) {
    $rels = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=8" -Headers $headers
    foreach ($rel in $rels) {
        # Vulkan build: GPU em qualquer placa + fallback CPU (-ngl 0), sem CUDA externo.
        $hit = $rel.assets | Where-Object { $_.name -match "win-vulkan-x64\.zip$" } | Select-Object -First 1
        if ($hit) { $asset = $hit; $tag = $rel.tag_name; break }
    }
    if ($asset) { break }
    Write-Host "asset win-vulkan-x64 ainda não disponível; aguardando 15s..."
    Start-Sleep -Seconds 15
}
if (-not $asset) { throw "asset win-vulkan-x64.zip não encontrado nas últimas releases do llama.cpp" }

Write-Host "Baixando $($asset.name) do release $tag ($([math]::Round($asset.size/1MB,1)) MB)..."
$zip = Join-Path $env:TEMP $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $llamaDir -Force
Remove-Item $zip -Force

Write-Host "Instalado em $llamaDir ($tag)"
