#!/bin/bash
# Configura tudo na Cloudflare em uma rodada. Rode de dentro da pasta do projeto:
#   bash scripts/configurar.sh
# Pode rodar de novo sem problema: pula o que já estiver feito.
set -euo pipefail
cd "$(dirname "$0")/.."

passo() { printf "\n\033[1;33m== %s\033[0m\n" "$1"; }
troca() { node -e 'const fs=require("fs");const [f,a,b]=process.argv.slice(1);fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(a,b))' "$@"; }

passo "1/7 Conferindo Node.js"
command -v node >/dev/null || { echo "Instale o Node.js (https://nodejs.org, versão LTS) e rode de novo."; exit 1; }
node -v

passo "2/7 Instalando o wrangler (ferramenta da Cloudflare)"
npm install --silent

passo "3/7 Login na Cloudflare (abre o navegador; entre com gabriel@polenta.cc e clique em Allow)"
if npx wrangler whoami 2>/dev/null | grep -q "You are logged in"; then echo "Já logado."; else npx wrangler login; fi

passo "4/7 Criando o armazenamento (KV)"
if grep -q "PREENCHER_COM_O_ID_DO_KV" wrangler.toml; then
  SAIDA="$(npx wrangler kv namespace create polenta-stories-estado 2>&1 || true)"
  KV_ID="$(printf '%s' "$SAIDA" | grep -oE '[0-9a-f]{32}' | head -1)"
  [ -n "$KV_ID" ] || { echo "$SAIDA"; echo "Não consegui criar o KV. Se ele já existe, rode: npx wrangler kv namespace list e cole o id no wrangler.toml."; exit 1; }
  troca wrangler.toml "PREENCHER_COM_O_ID_DO_KV" "$KV_ID"
  echo "KV criado: $KV_ID"
else echo "KV já configurado."; fi

passo "5/7 Primeiro deploy"
SAIDA="$(npx wrangler deploy 2>&1 | tee /dev/stderr)"
URL="$(printf '%s' "$SAIDA" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"
[ -n "$URL" ] || { echo "Não achei a URL do Worker. Ative o subdomínio workers.dev no painel (Workers & Pages) e rode de novo."; exit 1; }
troca wrangler.toml 'https://polenta-stories.SEU-SUBDOMINIO.workers.dev' "$URL"
echo "URL: $URL"

passo "6/7 Segredos"
if npx wrangler secret list 2>/dev/null | grep -q IG_ACCESS_TOKEN; then
  echo "IG_ACCESS_TOKEN já cadastrado (para trocar: npx wrangler secret put IG_ACCESS_TOKEN)."
else
  echo "Cole o TOKEN DA PÁGINA (Cmd+V) e tecle Enter. Ele não aparece na tela."
  npx wrangler secret put IG_ACCESS_TOKEN
fi
if [ ! -s .admin_key ]; then
  openssl rand -hex 24 > .admin_key && chmod 600 .admin_key
  npx wrangler secret put ADMIN_KEY < .admin_key >/dev/null
  echo "ADMIN_KEY gerada e salva em .admin_key (só neste Mac)."
fi

passo "7/7 Enviando as artes e publicando a versão final"
bash scripts/subir-artes.sh
npx wrangler deploy >/dev/null
echo "Deploy final ok."

passo "Teste (não publica nada)"
curl -s -H "Authorization: Bearer $(cat .admin_key)" "$URL/check?container=1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(d),null,2))}catch{console.log(d)}})'
echo
echo "Esperado: conta.username = polenta.cc, artesFaltando = [], container.id preenchido."
echo "Painel de status: $URL/status"
