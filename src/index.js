// Polenta Stories — publica Stories do @polenta.cc no horário do roteiro.
// Cron a cada minuto; publica o que venceu há no máximo JANELA_MIN minutos.
// Estado (publicado/erro/perdido) e artes JPEG ficam no mesmo KV (artes com
// prefixo "arte:"), servidas por este Worker em /img/<chave> (a API exige URL pública).

import roteiro from "../roteiro.json";

const GRAPH = "https://graph.facebook.com/v26.0";
const JANELA_MIN = 30;
const MAX_TENTATIVAS = 3;

export const chaveArte = (item) => item.origem.replace(/\.png$/i, ".jpg");

// ---------- Graph API ----------
async function graph(env, metodo, caminho, params = {}) {
  const corpo = new URLSearchParams({ ...params, access_token: env.IG_ACCESS_TOKEN });
  const url = metodo === "GET" ? `${GRAPH}${caminho}?${corpo}` : `${GRAPH}${caminho}`;
  const resp = await fetch(url, metodo === "GET" ? {} : { method: "POST", body: corpo });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.error) {
    const e = json.error || {};
    throw new Error(`Graph ${resp.status}: ${e.message || "erro"} (code ${e.code ?? "?"}, subcode ${e.error_subcode ?? "-"})`);
  }
  return json;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export async function criarContainer(env, item) {
  const image_url = `${env.PUBLIC_BASE_URL}/img/${encodeURI(chaveArte(item))}`;
  const { id } = await graph(env, "POST", `/${env.IG_USER_ID}/media`, { image_url, media_type: "STORIES" });
  for (let i = 0; i < 10; i++) {
    const { status_code } = await graph(env, "GET", `/${id}`, { fields: "status_code" });
    if (status_code === "FINISHED") return id;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`Container ${status_code}`);
    await esperar(3000);
  }
  throw new Error("Container não ficou pronto a tempo");
}

export async function publicar(env, item) {
  const creation_id = await criarContainer(env, item);
  const { id } = await graph(env, "POST", `/${env.IG_USER_ID}/media_publish`, { creation_id });
  return id;
}

// ---------- Ciclo agendado ----------
export async function processar(env, agora = Date.now()) {
  const log = [];
  for (const item of roteiro.stories) {
    if (item.ativo === false) continue;
    const t = Date.parse(item.quando);
    if (agora < t) continue;
    const chave = `estado:${item.id}`;
    const estado = (await env.ESTADO.get(chave, "json")) || {};
    if (estado.status === "publicado" || estado.status === "perdido") continue;

    if (agora - t > JANELA_MIN * 60000) {
      if (estado.status !== "erro_final") {
        await env.ESTADO.put(chave, JSON.stringify({ ...estado, status: "perdido", em: new Date(agora).toISOString() }));
        log.push(`${item.id}: perdido (fora da janela)`);
      }
      continue;
    }
    if ((estado.tentativas || 0) >= MAX_TENTATIVAS) continue;

    // trava simples contra execuções sobrepostas do cron
    const trava = `trava:${item.id}`;
    if (await env.ESTADO.get(trava)) continue;
    await env.ESTADO.put(trava, "1", { expirationTtl: 240 });

    const tentativas = (estado.tentativas || 0) + 1;
    try {
      if (env.DRY_RUN === "true") {
        const containerId = await criarContainer(env, item);
        await env.ESTADO.put(chave, JSON.stringify({ status: "teste_ok", containerId, tentativas: 0, em: new Date(agora).toISOString() }));
        log.push(`${item.id}: DRY_RUN ok (container ${containerId}, nada publicado)`);
      } else {
        const mediaId = await publicar(env, item);
        await env.ESTADO.put(chave, JSON.stringify({ status: "publicado", mediaId, tentativas, em: new Date(agora).toISOString() }));
        log.push(`${item.id}: publicado (${mediaId})`);
      }
    } catch (err) {
      const status = tentativas >= MAX_TENTATIVAS ? "erro_final" : "erro";
      await env.ESTADO.put(chave, JSON.stringify({ status, erro: String(err.message || err), tentativas, em: new Date(agora).toISOString() }));
      log.push(`${item.id}: ${status} — ${err.message || err}`);
    } finally {
      await env.ESTADO.delete(trava);
    }
  }
  if (log.length) console.log(log.join("\n"));
  return log;
}

// ---------- HTTP ----------
const autorizado = (req, env) =>
  env.ADMIN_KEY && req.headers.get("authorization") === `Bearer ${env.ADMIN_KEY}`;

async function statusJson(env) {
  const linhas = [];
  for (const item of roteiro.stories) {
    const estado = (await env.ESTADO.get(`estado:${item.id}`, "json")) || { status: item.ativo === false ? "desativado" : "agendado" };
    linhas.push({ id: item.id, quando: item.quando, descricao: item.descricao, ...estado });
  }
  return linhas;
}

function statusHtml(linhas) {
  const cor = { desativado: "#94A3B8", publicado: "#196B24", agendado: "#156082", teste_ok: "#156082", erro: "#E97132", erro_final: "#B42318", perdido: "#B42318" };
  const tr = linhas.map((l) => `<tr><td>${l.quando.slice(0, 16).replace("T", " ")}</td><td>${l.descricao}</td>
    <td style="color:${cor[l.status] || "#475569"};font-weight:600">${l.status}</td><td>${l.erro || l.mediaId || ""}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stories @polenta.cc</title><style>body{font-family:system-ui,sans-serif;margin:16px;color:#0F172A;background:#fff}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:8px;border-bottom:1px solid #E2E8F0;text-align:left;vertical-align:top}</style>
<h1 style="font-size:20px">Stories automáticos — @polenta.cc</h1><table><tr><th>Quando</th><th>Story</th><th>Status</th><th>Detalhe</th></tr>${tr}</table>`;
}

export default {
  async scheduled(_evento, env, ctx) {
    ctx.waitUntil(processar(env));
  },

  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/img/")) {
      const chave = decodeURIComponent(url.pathname.slice(5));
      const obj = await env.ESTADO.get(`arte:${chave}`, "arrayBuffer");
      if (!obj) return new Response("não encontrado", { status: 404 });
      return new Response(obj, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" } });
    }

    if (url.pathname === "/" || url.pathname === "/status") {
      const linhas = await statusJson(env);
      if (url.searchParams.get("formato") === "json") return Response.json(linhas);
      return new Response(statusHtml(linhas), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (!autorizado(req, env)) return new Response("não autorizado", { status: 401 });

    // Verifica token, conta e se todas as artes estão no KV. Não publica nada.
    if (url.pathname === "/check") {
      const r = { conta: null, artesFaltando: [], container: null };
      try { r.conta = await graph(env, "GET", `/${env.IG_USER_ID}`, { fields: "username" }); }
      catch (e) { r.conta = { erro: e.message }; }
      const existentes = new Set();
      let cursor;
      do {
        const pag = await env.ESTADO.list({ prefix: "arte:", cursor });
        pag.keys.forEach((k) => existentes.add(k.name.slice(5)));
        cursor = pag.list_complete ? undefined : pag.cursor;
      } while (cursor);
      for (const item of roteiro.stories) if (!existentes.has(chaveArte(item))) r.artesFaltando.push(chaveArte(item));
      // ?container=1 cria um container de teste (não publica) com a próxima arte
      if (url.searchParams.get("container") === "1") {
        const prox = roteiro.stories.find((i) => Date.parse(i.quando) > Date.now()) || roteiro.stories[0];
        try { r.container = { id: await criarContainer(env, prox), arte: chaveArte(prox) }; }
        catch (e) { r.container = { erro: e.message }; }
      }
      return Response.json(r);
    }

    // Publica um item agora (teste manual ou recuperar um "perdido"): POST /publicar?id=...
    if (url.pathname === "/publicar" && req.method === "POST") {
      const item = roteiro.stories.find((i) => i.id === url.searchParams.get("id"));
      if (!item) return new Response("id inexistente", { status: 404 });
      try {
        const mediaId = await publicar(env, item);
        await env.ESTADO.put(`estado:${item.id}`, JSON.stringify({ status: "publicado", mediaId, manual: true, em: new Date().toISOString() }));
        return Response.json({ ok: true, mediaId });
      } catch (e) {
        return Response.json({ ok: false, erro: e.message }, { status: 502 });
      }
    }

    return new Response("não encontrado", { status: 404 });
  },
};
