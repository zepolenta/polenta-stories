#!/bin/bash
# Converte as artes do roteiro (PNG no Google Drive) para JPEG e envia ao KV da Cloudflare.
# Uso: npm run subir-artes            (acha a pasta stories sozinho)
#      npm run subir-artes -- "/caminho/da/pasta/stories"
# Rodar de novo é seguro: sobrescreve a arte com a versão atual do Drive.
set -euo pipefail
cd "$(dirname "$0")/.."

ORIGEM="${1:-}"
if [ -z "$ORIGEM" ]; then
  ORIGEM="$(find "$HOME/Library/CloudStorage" -maxdepth 10 -type d -path "*Lettering novo (out-2026)/stories" 2>/dev/null | head -1)"
fi
if [ -z "$ORIGEM" ] || [ ! -d "$ORIGEM" ]; then
  echo "Pasta stories não encontrada. Passe o caminho: npm run subir-artes -- \"/caminho/stories\"" >&2
  exit 1
fi
echo "Origem: $ORIGEM"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

node -e 'for (const s of require("./roteiro.json").stories) console.log(s.origem)' | while IFS= read -r REL; do
  SRC="$ORIGEM/$REL"
  KEY="${REL%.png}.jpg"
  if [ ! -f "$SRC" ]; then echo "FALTA  $REL"; continue; fi
  OUT="$TMP/arte.jpg"
  sips -s format jpeg -s formatOptions 90 "$SRC" --out "$OUT" >/dev/null
  W=$(sips -g pixelWidth "$OUT" | awk '/pixelWidth/{print $2}')
  H=$(sips -g pixelHeight "$OUT" | awk '/pixelHeight/{print $2}')
  BYTES=$(stat -f%z "$OUT")
  [ "$W" = "1080" ] && [ "$H" = "1920" ] || echo "AVISO  $REL está ${W}x${H} (ideal 1080x1920)"
  [ "$BYTES" -lt 8000000 ] || { echo "ERRO   $REL passa de 8 MB"; continue; }
  npx wrangler kv key put --binding ESTADO "arte:$KEY" --path "$OUT" --remote </dev/null >/dev/null
  echo "OK     $KEY"
done
echo "Concluído. Confira em /check (artesFaltando deve vir vazio)."
