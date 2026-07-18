# Baixa o build Vulkan (Windows) do llama.cpp e instala em
# src-tauri/binaries/llama (llama-server.exe + DLLs do ggml).
# Assets do Windows são .zip; o Linux/AppImage usa o .tar.gz (fetch-llama.sh).
# Vulkan: GPU em qualquer placa + fallback CPU (-ngl 0), sem CUDA externo.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/fetch-llama.ps1
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ---------------------------------------------------------------------------
# VERSÃO FIXA + SHA256 (2026-07-18)
#
# Antes: consultava a API do GitHub pelas releases mais recentes e pegava a
# primeira com o asset Vulkan. Isso trazia um llama-server DIFERENTE a cada
# build, sem registro de qual, e sem conferir nada do que chegava. Um binário de
# terceiro entrava no instalador sem verificação — a superfície de supply-chain
# que a passada de 2026-07-18 fechou na suíte inteira.
#
# Com a tag fixa, some também toda a robustez que existia SÓ por causa do
# `latest`: a release incompleta (assets subindo aos poucos), o laço de 3
# tentativas com sleep, e o GH_TOKEN pra driblar rate-limit da API. Numa tag
# fixa o asset ou existe ou o build falha alto — que é o certo.
#
# PRA ATUALIZAR: escolher a tag em github.com/ggml-org/llama.cpp/releases,
# baixar os dois artefatos, rodar `sha256sum` e trocar as constantes aqui e no
# `fetch-llama.sh`. Os dois têm que apontar pra MESMA tag.
# ---------------------------------------------------------------------------
# Tag do upstream (proveniencia; a URL usa o espelho da suite).
$llUpstreamTag = "b10066"
$llAsset = "llama-b10066-bin-win-vulkan-x64.zip"
$llSha256 = "57cb5dd3143b2814b8d1d14587867628bfb126536abfa7085ca9560c4919d998"

$root = Split-Path -Parent $PSScriptRoot
$llamaDir = Join-Path $root "src-tauri\binaries\llama"
New-Item -ItemType Directory -Force -Path $llamaDir | Out-Null

if (Test-Path (Join-Path $llamaDir "llama-server.exe")) {
    Write-Host "llama runtime já existe em $llamaDir"
    exit 0
}

$url = "https://github.com/Anon5T4R/Local-runtimes/releases/download/v1/$llAsset"
Write-Host "Baixando $url ..."
$zip = Join-Path $env:TEMP $llAsset
Invoke-WebRequest -Uri $url -OutFile $zip

# Confere ANTES de extrair: binário adulterado não chega a ser descompactado.
$got = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
if ($got -ne $llSha256) {
    Remove-Item $zip -Force
    throw "SHA256 NAO BATE!`n  esperado: $llSha256`n  recebido: $got`nDownload corrompido ou adulterado. Nada foi instalado."
}
Write-Host "sha256 conferido: $got"

Expand-Archive -Path $zip -DestinationPath $llamaDir -Force
Remove-Item $zip -Force
Write-Host "Instalado em $llamaDir ($llUpstreamTag)"
