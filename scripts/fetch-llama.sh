#!/usr/bin/env bash
# Baixa o llama.cpp (Linux x64, Vulkan com fallback CPU) e instala em binaries/llama.
# IMPORTANTE: os assets Linux do llama.cpp são .tar.gz (NÃO .zip) — por isso o
# AppImage não precisa de nenhuma ferramenta de zip. Só o Windows usa .zip
# (scripts/fetch-llama.ps1).
# Uso: bash scripts/fetch-llama.sh
set -euo pipefail

# ---------------------------------------------------------------------------
# VERSÃO FIXA + SHA256 (2026-07-18) — ver o comentário longo no fetch-llama.ps1.
#
# Resumo: antes varria a API do GitHub pelas releases recentes e pegava a
# primeira com o asset — binário diferente a cada build, sem verificação. Com a
# tag fixa saem juntos o laço de 3 tentativas, o sleep, o GH_TOKEN (rate-limit da
# API) e o teste `gzip -t`: tudo isso existia só por causa do `latest`, e o
# sha256 é uma checagem estritamente mais forte que o `gzip -t`.
#
# PRA ATUALIZAR: trocar as constantes aqui E no .ps1, sempre na MESMA tag.
# ---------------------------------------------------------------------------
LL_TAG="b10066"
LL_ASSET="llama-b10066-bin-ubuntu-vulkan-x64.tar.gz"
LL_SHA256="37831256be31aacf8ffe5bfc0a88040ef6f0224c220777b28fd77d4198a0b902"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LLAMA_DIR="$ROOT/src-tauri/binaries/llama"
mkdir -p "$LLAMA_DIR"

if [ -f "$LLAMA_DIR/llama-server" ]; then
  echo "llama runtime já existe em $LLAMA_DIR"
  exit 0
fi

URL="https://github.com/ggml-org/llama.cpp/releases/download/$LL_TAG/$LL_ASSET"
echo "Baixando $URL ..."
curl -fsSL --retry 3 --retry-delay 2 "$URL" -o /tmp/llama.tar.gz

# Confere ANTES de extrair: binário adulterado não chega a ser descompactado.
GOT=$(sha256sum /tmp/llama.tar.gz | cut -d' ' -f1)
if [ "$GOT" != "$LL_SHA256" ]; then
  rm -f /tmp/llama.tar.gz
  echo "SHA256 NAO BATE!" >&2
  echo "  esperado: $LL_SHA256" >&2
  echo "  recebido: $GOT" >&2
  echo "Download corrompido ou adulterado. Nada foi instalado." >&2
  exit 1
fi
echo "sha256 conferido: $GOT"

rm -rf /tmp/llama-extract
mkdir -p /tmp/llama-extract
tar -xzf /tmp/llama.tar.gz -C /tmp/llama-extract
SRV=$(find /tmp/llama-extract -type f -name 'llama-server' | head -1)
[ -z "$SRV" ] && { echo "llama-server não encontrado no arquivo"; exit 1; }
cp -r "$(dirname "$SRV")"/* "$LLAMA_DIR"/
chmod +x "$LLAMA_DIR/llama-server" || true
rm -rf /tmp/llama.tar.gz /tmp/llama-extract
echo "Instalado em $LLAMA_DIR ($LL_TAG)"
