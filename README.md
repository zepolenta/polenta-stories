# Polenta Stories — publicação automática no @polenta.cc

Um Cloudflare Worker (com KV, sem R2 e sem cartão) que publica os Stories de chamada ("Post novo") no horário do roteiro. Ele usa a API oficial do Instagram, via Facebook Login com a página da Polenta.

- **Automático:** as 10 chamadas de outubro, às 18h35.
- **Continua no lembrete:** os potes e o "Como pedir" 1-3 de 3, porque precisam do adesivo de Link (a API não permite adesivo).
- **Status:** a página `https://polenta-stories.<subdominio>.workers.dev/status` mostra cada Story como agendado, publicado, erro ou perdido.
- **Segurança:** se o horário passar há mais de 30 min (Mac fora, token vencido etc.), o Story é marcado como "perdido" e não sai atrasado. Para cada erro são feitas até 3 tentativas, e nada é publicado em duplicidade.

Tempo estimado de configuração: 40 a 60 minutos, uma vez só.

---

## Parte A — Facebook e Meta (feita por você, nas suas contas)

1. **Conta no Facebook.** Crie uma conta pessoal. Ela é obrigatória para ter página e para usar o Meta for Developers, e não precisa ser usada para mais nada.
2. **Página.** Em facebook.com > Páginas > Criar página:
   - Nome: *Polenta Comidinhas Criativas*.
   - Categoria: *Empresa de alimentos e bebidas*.
   - Bio e link: polenta.cc.
3. **Instagram como conta profissional, ligado à página.**
   - No app do Instagram, confira que o @polenta.cc é conta **Empresa** ou **Criador de conteúdo** (Configurações > Tipo de conta e ferramentas).
   - Na página do Facebook, vá em Configurações > Contas vinculadas > Instagram > Conectar e entre com o @polenta.cc.
4. **App no Meta for Developers.**
   - Em developers.facebook.com > Meus apps > Criar app, escolha o caso de uso de gerenciar conteúdo/mensagens do Instagram (tipo Business).
   - Adicione o produto **Instagram** na opção *API com login do Facebook*.
   - Deixe o app em **modo de desenvolvimento**. Como você é administrador do app e da conta, não precisa de revisão da Meta.
5. **Token da página, que não expira.**
   - No *Graph API Explorer*, selecione o app e gere um token de usuário com as permissões: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`.
   - No *Access Token Debugger*, clique em **Extend Access Token** e copie o token longo gerado.
   - De volta ao Explorer, com esse token longo, rode `GET me/accounts`. O `access_token` que aparece na linha da página é o **token da página**.
   - Confira no Debugger: o campo *Expires* deve mostrar **Never**.
6. **ID do Instagram.**
   - No Explorer, rode `GET <id-da-página>?fields=instagram_business_account`.
   - Anote o `id` que vier (um número que começa com 1784…).

> **Importante:** o token é uma senha. Não cole no chat nem neste repositório. Ele vai direto para o Cloudflare no passo B4.

## Parte B — Cloudflare (uma rodada só, no Terminal do Mac)

```bash
cd ~/Downloads/polenta-stories      # ou onde você descompactou
bash scripts/configurar.sh
```

O script faz, nesta ordem:

1. Instala o wrangler.
2. Faz o login na Cloudflare: abre o navegador, você clica em Allow.
3. Cria o KV, que guarda as artes e o estado de cada Story.
4. Faz o primeiro deploy e anota a URL.
5. Pede o **token da página**: cole com Cmd+V, ele não aparece na tela. Gera também a `ADMIN_KEY`.
6. Converte as artes para JPEG e envia ao KV.
7. Faz o deploy final e roda o `/check`, que não publica nada.

Resultado esperado no fim:

- `conta.username` = `polenta.cc`;
- `artesFaltando` = `[]`;
- `container.id` preenchido.

Se o script parar, rode de novo: ele pula o que já foi feito.

## Parte C — Conferência

- **Painel:** `https://polenta-stories.<…>.workers.dev/status`.
- **Modo de teste:** com `DRY_RUN = "true"` no `wrangler.toml`, o cron faz tudo menos publicar.

## Parte D — Rotina das próximas semanas (uns 5 min por semana)

1. Salve as artes novas no Drive, em `stories/chamadas/`, com o nome no padrão `AAAA-MM-DD-HHhMM-post-<tema>.png` (1080x1920).
2. Acrescente uma linha por Story no `roteiro.json` (id, horário com `-03:00`, origem, descrição). Para segurar um Story sem apagar a linha, use `"ativo": false`.
3. Rode `npm run subir-artes`.
4. Rode `npm run deploy`.
5. Confira a página `/status`.

Outros comandos úteis:

- **Publicar manualmente** um Story perdido: `curl -X POST -H "Authorization: Bearer $(cat .admin_key)" "<url>/publicar?id=2026-10-10-historia"`.
- **Logs ao vivo:** `npm run logs`.
- **Testes locais**, com API simulada: `npm test`.

## Limitações conhecidas

- Sem adesivo de Link, enquete ou menção: limite da API oficial.
- Só imagem JPEG de até 8 MB. O script já converte o PNG.
- O app em modo de desenvolvimento funciona apenas para contas em que você é administrador, que é exatamente o caso aqui.
