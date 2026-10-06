// Simula o Worker com Graph API, KV e R2 falsos. Não toca no Instagram.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const raiz = new URL("..", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "ps-"));
const fonte = readFileSync(join(raiz, "src/index.js"), "utf8").replace(
  'import roteiro from "../roteiro.json";',
  `const roteiro = ${readFileSync(join(raiz, "roteiro.json"), "utf8")};`
);
writeFileSync(join(tmp, "w.mjs"), fonte);
globalThis.setTimeout = ((orig) => (fn) => orig(fn, 0))(globalThis.setTimeout); // sem espera real
const mod = await import(join(tmp, "w.mjs"));

function kv() {
  const m = new Map();
  return { m,
    async get(k, t) { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const chamadas = [];
let falhar = false;
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? Object.fromEntries(init.body) : Object.fromEntries(new URL(url).searchParams);
  chamadas.push({ url: String(url).split("?")[0], body });
  if (falhar) return new Response(JSON.stringify({ error: { message: "token inválido", code: 190 } }), { status: 400 });
  if (url.endsWith("/media")) return Response.json({ id: "C1" });
  if (url.endsWith("/media_publish")) return Response.json({ id: "M1" });
  return Response.json({ status_code: "FINISHED" });
};
const env = { ESTADO: kv(), IG_USER_ID: "178", IG_ACCESS_TOKEN: "SEGREDO123", PUBLIC_BASE_URL: "https://w.dev", DRY_RUN: "false" };
const t = (iso) => Date.parse(iso);

// 1) antes do horário: nada
assert.deepEqual(await mod.processar(env, t("2026-10-06T18:30:00-03:00")), []);
// 2) no horário: publica a prateleira com JPEG e STORIES
let log = await mod.processar(env, t("2026-10-06T18:36:00-03:00"));
assert.match(log[0], /prateleira: publicado/);
const criar = chamadas.find((c) => c.url.endsWith("/media"));
assert.equal(criar.body.media_type, "STORIES");
assert.equal(criar.body.image_url, "https://w.dev/img/chamadas/2026-10-06-18h35-post-prateleira.jpg");
// 3) cron seguinte: não duplica
const antes = chamadas.length;
assert.deepEqual(await mod.processar(env, t("2026-10-06T18:41:00-03:00")), []);
assert.equal(chamadas.length, antes);
// 4) erro: tenta 3 vezes e para
falhar = true;
for (const m of ["18:36", "18:41", "18:46", "18:51"]) await mod.processar(env, t(`2026-10-08T${m}:00-03:00`));
const capeta = JSON.parse(env.ESTADO.m.get("estado:2026-10-08-capeta"));
assert.equal(capeta.status, "erro_final"); assert.equal(capeta.tentativas, 3);
assert.match(capeta.erro, /token inválido/);
falhar = false;
// 5) fora da janela: marca perdido, não publica atrasado
const n = chamadas.length;
log = await mod.processar(env, t("2026-10-10T20:00:00-03:00"));
assert.ok(log.some((l) => /historia: perdido/.test(l)));
assert.equal(chamadas.length, n);
// 6) DRY_RUN não chama media_publish
const env2 = { ...env, ESTADO: kv(), DRY_RUN: "true" };
chamadas.length = 0;
await mod.processar(env2, t("2026-10-13T18:36:00-03:00"));
assert.ok(!chamadas.some((c) => c.url.endsWith("/media_publish")));
// 7) token não aparece em mensagens de erro
assert.ok(!capeta.erro.includes("SEGREDO123"));

console.log("Simulação OK: 7 cenários.");

// 8) itens com ativo:false não publicam (mostarda)
const env3 = { ...env, ESTADO: kv() };
chamadas.length = 0;
const l3 = await mod.processar(env3, t("2026-10-23T12:01:00-03:00"));
assert.ok(!l3.some((l) => /mostarda/.test(l)));
// 9) sequência do como pedir sai em ordem no mesmo minuto quando atrasada
const env4 = { ...env, ESTADO: kv() };
const l4 = await mod.processar(env4, t("2026-10-20T18:43:00-03:00"));
const seq = l4.filter((l) => /como-pedir/.test(l)).map((l) => l.split(":")[0]);
assert.deepEqual(seq, ["2026-10-20-como-pedir-1", "2026-10-20-como-pedir-2", "2026-10-20-como-pedir-3"]);
console.log("Simulação OK: 9 cenários.");
