// Sincroniza conjuntos do Portal da Transparência (Megasoft) com o Supabase da transparência.
// O portal é um app Angular cuja tabela é preenchida por uma API JSON ("/paginado") que exige o token do
// próprio app. Por isso a coleta usa um navegador do Firecrawl (interact): abre a página do portal,
// captura a chamada que ela faz e repete essa chamada pedindo 1000 registros por página.
//
// Uso:  node sync.mjs [dataset|todos] [ano] [--dry-run]
// Env:  FIRECRAWL_API_KEY, TRANSPARENCIA_SUPABASE_SERVICE_ROLE_KEY (não exigida em --dry-run),
//       TRANSPARENCIA_SUPABASE_URL (obrigatória) e PORTAL_BASE_URL (padrão: portal de São João).
import { readFileSync, writeFileSync } from "node:fs";
import { DATASETS } from "./datasets.mjs";

const FIRECRAWL = "https://api.firecrawl.dev/v2";
const PORTAL = (process.env.PORTAL_BASE_URL || envLocal("PORTAL_BASE_URL") || "https://saojoaodaparauna.megasofttransparencia.com.br").replace(/\/$/, "");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DRY_RUN = process.argv.includes("--dry-run");
const ALVO = args[0] || "todos";
const ANO = Number(args[1]) || new Date().getFullYear();

// No GitHub as variáveis vêm dos Secrets; num servidor ou computador, podem ficar num .env ao lado deste script.
function envLocal(nome) {
  try {
    const linha = readFileSync(new URL("./.env", import.meta.url), "utf8").split(/\r?\n/).find((l) => l.startsWith(nome + "="));
    return linha ? linha.slice(nome.length + 1).trim().replace(/^"|"$/g, "") : "";
  } catch { return ""; }
}
const env = (nome) => process.env[nome] || envLocal(nome);
const SUPABASE_URL = env("TRANSPARENCIA_SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = env("TRANSPARENCIA_SUPABASE_SERVICE_ROLE_KEY");
const FC_KEY = env("FIRECRAWL_API_KEY");

function exigir(cond, msg) { if (!cond) { console.error("Erro: " + msg); process.exit(1); } }

// ---------- Firecrawl ----------
// O plano do Firecrawl limita as chamadas por minuto: no limite, espera o tempo indicado e repete.
async function firecrawl(method, path, body) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(FIRECRAWL + path, {
      method,
      headers: { Authorization: `Bearer ${FC_KEY}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    const limite = r.status === 429 || /rate limit/i.test(String(data.error ?? ""));
    if (limite && tentativa <= 8) {
      const segundos = Number(String(data.error ?? "").match(/retry after (\d+)s/i)?.[1]) || 30;
      console.log(`  limite de chamadas do Firecrawl: aguardando ${segundos + 2}s`);
      await new Promise((ok) => setTimeout(ok, (segundos + 2) * 1000));
      continue;
    }
    if (!r.ok || data.success === false) throw new Error(`Firecrawl ${method} ${path}: ${data.error || r.status}`);
    return data;
  }
}

// Início comum aos dois coletores: define `req` (URL, método, corpo e cabeçalhos da consulta "/paginado").
// Com API (conjunto que declara `api`), monta a chamada direto: o token público vem da configuração que o
// portal entrega a todo visitante, e o ano/filtros vão no corpo, onde o portal realmente os aplica.
// Sem API, abre a página do portal e captura a chamada que ela faz.
const CONSULTA = String.raw`
const API_FIXA = __API__;
let req = null;
if (API_FIXA) {
  const origem = new URL(URL_ALVO).origin;
  const cfg = await (await page.request.get(origem + "/api/configuracao/carregamento-inicial", { headers: { referer: origem + "/" }, timeout: 60000 })).json();
  if (!cfg.tokenPortal) throw new Error("O portal não informou o token de acesso");
  req = {
    url: origem + "/api/" + API_FIXA.caminho, metodo: API_FIXA.metodo || "GET", corpo: API_FIXA.corpo ? JSON.stringify(API_FIXA.corpo) : null,
    headers: { authorization: "Bearer " + cfg.tokenPortal, "cliente-integrado": "megasoft-portal-da-transparencia", referer: origem + "/", "content-type": "application/json" },
  };
} else {
  page.on("request", r => { if (!req && /\/paginado(\?|$)/.test(r.url())) req = { url: r.url(), metodo: r.method(), corpo: r.postData(), headers: r.headers() }; });
  await page.goto(URL_ALVO, { waitUntil: "networkidle", timeout: 60000 });
  for (let i = 0; i < 30 && !req; i++) await page.waitForTimeout(500);
  if (!req) throw new Error("A página do portal não fez a consulta de dados (/paginado)");
}
`;

// Executado dentro do navegador do Firecrawl: obtém a chamada "/paginado" (URL e cabeçalhos com o token
// do app) e lê a API a partir da posição INICIO, devolvendo só os campos pedidos.
// Defeitos conhecidos da API do portal, tratados aqui:
//  - registro que derruba qualquer página onde aparece (erro 500): a faixa é dividida (500→100→50→10→1)
//    até isolar o registro, que é pulado e contado em `ignorados`;
//  - limite de tamanho por página (ex.: corta em 900): página curta seguida de mais registros reduz o tamanho;
//  - "total" maior que a lista real: a leitura termina quando a lista acaba (página curta sem registro depois).
const COLETOR = String.raw`await (async () => {
const URL_ALVO = __URL__, INICIO = __INICIO__, CAMPOS = __CAMPOS__, LIMITE_BYTES = 600000, PRAZO = Date.now() + 150000;
const ESCADA = [500, 100, 50, 10, 1];
let TAMANHO = __TAMANHO__ || 500;
${CONSULTA}
const h = {}; for (const k of Object.keys(req.headers)) if (!/^(host|content-length|:)/.test(k)) h[k] = req.headers[k];
const pegar = (o, caminho) => caminho.split(".").reduce((v, k) => (v == null ? v : v[k]), o);
const PAUSA = "pausa-por-prazo";
// Algumas páginas (ex.: contratos) consultam por POST, com a paginação no corpo JSON.
const buscar = async (pagina, tamanho) => {
  if (Date.now() > PRAZO) throw new Error(PAUSA);
  const r = req.metodo === "POST"
    ? await page.request.post(req.url, { headers: h, data: { ...JSON.parse(req.corpo || "{}"), pagina, tamanhoDaPagina: tamanho }, timeout: 120000 })
    : await page.request.get(req.url.replace(/([?&])pagina=\d+/, "$1pagina=" + pagina).replace(/([?&])tamanhoDaPagina=\d+/, "$1tamanhoDaPagina=" + tamanho), { headers: h, timeout: 120000 });
  if (!r.ok()) return null;
  try { return await r.json(); } catch { return null; }
};
let total = null, ignorados = 0, bytes = 0, fim = false, listaInteira = false;
const registros = [];
const guardar = (lista) => { for (const o of lista) { const v = CAMPOS.map(c => pegar(o, c)); bytes += JSON.stringify(v).length; registros.push(v); } };
// Lê as posições [inicio, inicio + tam) e devolve quantas posições foram consumidas.
const faixa = async (inicio, tam) => {
  const j = await buscar(inicio / tam + 1, tam);
  // Algumas telas (vídeos) devolvem a lista inteira como array, sem paginação.
  // Outras (estatísticas do e-SIC) devolvem um único objeto: vira um registro só.
  if (j && !Array.isArray(j) && !Array.isArray(j.registros)) { listaInteira = true; total = 1; guardar([j]); return 1; }
  if (Array.isArray(j)) { listaInteira = true; if (total === null) total = j.length; guardar(j); return j.length; }
  if (j) { if (total === null) total = j.total; const l = j.registros || []; guardar(l); return l.length; }
  if (tam === 1) { ignorados++; return 1; }
  const menor = ESCADA.find(t => t < tam && tam % t === 0);
  let n = 0;
  for (let s = inicio; s < inicio + tam; s += menor) { const k = await faixa(s, menor); n += k; if (k < menor) break; }
  return n;
};
let pos = INICIO;
while (bytes < LIMITE_BYTES) {
  // Prazo da chamada esgotado no meio de um bloco: descarta o bloco e a próxima chamada o refaz em blocos menores.
  const marca = { linhas: registros.length, ignorados, bytes };
  let n;
  try { n = await faixa(pos, TAMANHO); }
  catch (e) {
    if (e.message !== PAUSA) throw e;
    registros.length = marca.linhas; ignorados = marca.ignorados; bytes = marca.bytes;
    TAMANHO = ESCADA.find(t => t < TAMANHO && pos % t === 0) || 1;
    break;
  }
  if (listaInteira) { fim = true; pos += n; break; }
  if (n < TAMANHO) {
    const depois = await buscar(pos + n + 1, 1);
    if (!(depois && (depois.registros || []).length)) { fim = true; pos += n; break; }
    pos += n;                                                      // limite do servidor: segue com páginas menores
    TAMANHO = ESCADA.find(t => t <= Math.max(n, 1) && pos % t === 0);
    continue;
  }
  pos += TAMANHO;
  if (total !== null && pos >= total) {
    const depois = await buscar(pos + 1, 1);
    if (!(depois && (depois.registros || []).length)) { fim = true; break; }
  }
}
console.log(JSON.stringify({ total, tamanho: TAMANHO, proximo: pos, fim, ignorados, registros }));
})();
`;

// Também executado no navegador: repete o que a tela de detalhe do portal faz para cada registro de CHAVES
// (a partir de INICIO). "/detalhe" traz os campos e as listas (empenhos, itens, aditivos...) com a primeira
// página de cada uma; listas maiores são relidas inteiras em "/<lista>/paginado". Os arquivos anexados vêm
// do serviço de documentos do portal (tabela TABELA). Guarda só valores simples, para a cópia ficar leve.
const COLETOR_DETALHE = String.raw`await (async () => {
const URL_ALVO = __URL__, CHAVES = __CHAVES__, INICIO = __INICIO__, TABELA = __TABELA__, EXTRA = __EXTRA__, CHAVE_LISTA = __CHAVE_LISTA__, SO_ARQUIVOS = __SO_ARQUIVOS__, LIMITE_BYTES = 600000, PRAZO = Date.now() + 150000, PARALELO = 4;
${CONSULTA}
const h = {}; for (const k of Object.keys(req.headers)) if (!/^(host|content-length|content-type|:)/.test(k)) h[k] = req.headers[k];
const base = req.url.split("/paginado")[0];
const api = base.slice(0, base.indexOf("/api/") + 4);
const json = async (url) => { const r = await page.request.get(url, { headers: h, timeout: 60000 }); if (!r.ok()) return null; try { return await r.json(); } catch { return null; } };
const simples = (o) => { const s = {}; for (const [k, v] of Object.entries(o || {})) if (v !== null && v !== "" && ["string", "number", "boolean"].includes(typeof v)) s[k] = v; return s; };
const tracos = (s) => s.replace(/([A-Z])/g, (m) => "-" + m.toLowerCase());
// CHAVES: [chave, consulta do detalhe]. Somatórios (ex.: totais de cada folha) são objetos simples e
// entram como lista de um item; com SO_ARQUIVOS (listas de documentos) só os anexos são lidos.
const detalhar = async ([chave, consulta]) => {
  const c = encodeURIComponent(chave);
  const d = SO_ARQUIVOS ? {} : await json(base + "/detalhe?" + consulta + EXTRA);
  if (!d || typeof d !== "object") return null;
  const listas = {};
  for (const [k, v] of Object.entries(d)) {
    if (/^somatorio/.test(k) && v && typeof v === "object" && !Array.isArray(v)) { const so = simples(v); if (Object.keys(so).length) listas[k] = [so]; continue; }
    let regs = Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray(v.registros) ? v.registros : null;
    if (!regs) continue;
    if (!Array.isArray(v) && (v.total || 0) > regs.length) {
      const j = await json(base + "/" + tracos(k) + "/paginado?" + CHAVE_LISTA + "=" + c + EXTRA + "&pagina=1&tamanhoDaPagina=1000");
      // Só aceita a releitura quando o total confere: em algumas telas o portal ignora o filtro e
      // devolve a lista de todos os registros (ex.: metas de ações e projetos).
      if (j && Array.isArray(j.registros) && j.registros.length > regs.length && (j.total == null || j.total === v.total)) regs = j.registros;
    }
    regs = regs.filter((x) => x && typeof x === "object").map(simples);
    if (regs.length) listas[k] = regs;
  }
  if (TABELA) {
    const a = await json(api + "/gestao-eletronica-de-documentos/?tabela=" + TABELA + "&codigoDoRegistro=" + c + "&pagina=1&tamanhoDaPagina=200");
    const regs = a && (Array.isArray(a) ? a : a.registros);
    if (Array.isArray(regs) && regs.length) listas.arquivos = regs.map(simples);
  }
  return { ...simples(d), listas };
};
const detalhes = [];
let pos = INICIO, bytes = 0, ignorados = 0;
while (pos < CHAVES.length && bytes < LIMITE_BYTES && Date.now() < PRAZO) {
  const lote = CHAVES.slice(pos, pos + PARALELO);
  const res = await Promise.all(lote.map((c) => detalhar(c).catch(() => null)));
  res.forEach((d, i) => { if (!d) { ignorados++; return; } bytes += JSON.stringify(d).length; detalhes.push([lote[i][0], d]); });
  pos += lote.length;
}
console.log(JSON.stringify({ proximo: pos, fim: pos >= CHAVES.length, ignorados, detalhes }));
})();
`;

function urlDaConsulta(dataset) {
  const filtro = {
    ano: `ano=${ANO}`,
    datas: `dataInicial=01/01/${ANO}&dataFinal=31/12/${ANO}`,
    acumulado: "",
  }[dataset.filtro || "ano"];
  const sep = dataset.path.includes("?") ? "&" : "?";
  return `${PORTAL}/${dataset.path}${filtro ? sep + filtro : ""}`;
}

// Meses consultados nos conjuntos mensais (folha): o ano todo, ou até o mês corrente no ano atual.
const HOJE = new Date();
const mesesDoAno = () => Array.from({ length: ANO < HOJE.getFullYear() ? 12 : HOJE.getMonth() + 1 }, (_, i) => String(i + 1).padStart(2, "0"));
// Último mês fechado, para cadastros que o portal só consulta por competência (estrutura de remuneração).
function ultimoMes() {
  const d = new Date(HOJE.getFullYear(), HOJE.getMonth() - 1, 1);
  return { ano: d.getFullYear(), mes: String(d.getMonth() + 1).padStart(2, "0") };
}

// Chamada fixa da API (conjuntos com `api`): o período vai no corpo do POST ou na URL do GET, como o
// filtro da página. `laco` é o mês (conjuntos mensais) ou o ano (conjuntos "anos") da volta atual.
function apiDaConsulta(dataset, laco) {
  if (!dataset.api) return null;
  const { caminho, metodo = "GET", corpo = {} } = dataset.api;
  const periodo = {
    ano: { ano: ANO },
    datas: { dataInicial: `01/01/${ANO}`, dataFinal: `31/12/${ANO}` },
    meses: { ano: ANO, mes: laco },
    anos: { ano: laco },
    "ultimo-mes": ultimoMes(),
    dezembro: { ano: ANO, mes: "12" },
    acumulado: {},
  }[dataset.filtro || "ano"];
  if (metodo === "POST") return { caminho, metodo, corpo: { ...corpo, ...periodo } };
  const consulta = Object.entries(periodo).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return { caminho: consulta ? `${caminho}${caminho.includes("?") ? "&" : "?"}${consulta}` : caminho, metodo, corpo: null };
}

// Campos lidos da API: o identificador (quando é um caminho) seguido das colunas configuradas.
const camposDaApi = (dataset) => [...(typeof dataset.chave === "string" ? [dataset.chave] : []), ...dataset.colunas.map((c) => c[1])];

// Abre uma sessão de navegador do Firecrawl e executa gerarCodigo() em chamadas sucessivas até a parte
// devolvida marcar `fim`; cada parte vai para aoReceber, que guarda onde a próxima chamada continua.
async function emSessao(gerarCodigo, aoReceber) {
  // O Firecrawl encerra a sessão do navegador perto dos 10 minutos: antes disso abre outra e segue de onde
  // parou (cada chamada recebe em gerarCodigo() a posição atual). Sessão que cai no meio da chamada também
  // é trocada, e a chamada é refeita.
  const VIDA_DA_SESSAO = 5.5 * 60 * 1000;
  let sessao = null, fim = false, falhas = 0;
  const abrir = async () => {
    const scrape = await firecrawl("POST", "/scrape", { url: `${PORTAL}/mapa-site`, formats: ["markdown"], waitFor: 1000 });
    const id = scrape.data?.metadata?.scrapeId;
    exigir(id, "o Firecrawl não devolveu scrapeId para abrir a sessão");
    return { id, desde: Date.now() };
  };
  const fechar = async () => { if (sessao) await firecrawl("DELETE", `/scrape/${sessao.id}/interact`).catch(() => {}); sessao = null; };
  try {
    for (let chamada = 1; chamada <= 100 && !fim; chamada++) {
      if (sessao && Date.now() - sessao.desde > VIDA_DA_SESSAO) { await fechar(); console.log("    [sessão do navegador renovada]"); }
      if (!sessao) sessao = await abrir();
      let res;
      try {
        res = await firecrawl("POST", `/scrape/${sessao.id}/interact`, { code: gerarCodigo(), language: "node", timeout: 290 });
      } catch (e) {
        if (!/Failed to execute code in browser session|: 50[234]$/i.test(e.message) || ++falhas > 3) throw e;
        console.log(`    [sessão do navegador caiu (${e.message.split(": ").pop()}); abrindo outra (${falhas}/3)]`);
        await fechar(); chamada--; continue;
      }
      falhas = 0;
      const saida = (res.stdout || res.result || "").trim().split("\n").pop();
      let parte;
      try { parte = JSON.parse(saida); } catch { throw new Error("Resposta inesperada do navegador: " + (res.stderr || saida).slice(-300)); }
      aoReceber(parte);
      fim = parte.fim;
    }
  } finally {
    await fechar();
  }
  return fim;
}

async function coletar(dataset, laco) {
  const campos = camposDaApi(dataset);
  const linhas = []; let total = 0, tamanho = 0, proximo = 0, ignorados = 0;
  const fim = await emSessao(
    () => COLETOR
      .replace("__URL__", JSON.stringify(urlDaConsulta(dataset))).replace("__API__", () => JSON.stringify(apiDaConsulta(dataset, laco)))
      .replace("__INICIO__", String(proximo)).replace("__TAMANHO__", String(tamanho))
      .replace("__CAMPOS__", JSON.stringify(campos)),
    (parte) => {
      total = parte.total ?? total; tamanho = parte.tamanho; proximo = parte.proximo;
      ignorados += parte.ignorados; linhas.push(...parte.registros);
      console.log(`  ${dataset.path}${laco ? ` (${dataset.filtro === "anos" ? "ano" : "mês"} ${laco})` : ""}: ${linhas.length} registros lidos (portal informa ${total}${ignorados ? `, ${ignorados} com erro no portal` : ""})`);
    },
  );
  if (!fim) throw new Error("a leitura não chegou ao fim da lista do portal");
  return { campos, linhas, total, ignorados };
}

// Tela de detalhe de cada registro: devolve Map(chave → detalhe) e quantos o portal não abriu.
// O Firecrawl aceita no máximo 100 KB de código por chamada: as chaves vão em lotes, e cada chamada
// devolve até onde chegou dentro do seu lote.
const LOTE_DE_CHAVES = 400;

async function coletarDetalhes(dataset, chaves) {
  const detalhes = new Map(); let proximo = 0, ignorados = 0;
  const pares = chaves.map((c) => [c, dataset.detalhe.consulta ? dataset.detalhe.consulta(c, ANO) : `chavePrimaria=${encodeURIComponent(c)}`]);
  const fim = await emSessao(
    () => COLETOR_DETALHE
      .replace("__URL__", JSON.stringify(urlDaConsulta(dataset))).replace("__API__", () => JSON.stringify(apiDaConsulta(dataset)))
      .replace("__CHAVES__", () => JSON.stringify(pares.slice(proximo, proximo + LOTE_DE_CHAVES)))
      .replace("__INICIO__", "0")
      .replace("__TABELA__", JSON.stringify(dataset.detalhe.tabela || ""))
      .replace("__EXTRA__", () => JSON.stringify(dataset.detalhe.ano ? `&ano=${ANO}` : ""))
      .replace("__CHAVE_LISTA__", () => JSON.stringify(dataset.detalhe.chaveDaLista || "codigo"))
      .replace("__SO_ARQUIVOS__", String(!!dataset.detalhe.somenteArquivos)),
    (parte) => {
      proximo += parte.proximo; ignorados += parte.ignorados;
      parte.fim = proximo >= pares.length;
      for (const [chave, d] of parte.detalhes) detalhes.set(String(chave), d);
      console.log(`  detalhe: ${proximo} de ${chaves.length} registros abertos${ignorados ? ` (${ignorados} sem detalhe no portal)` : ""}`);
    },
  );
  if (!fim) throw new Error("a leitura dos detalhes não chegou ao fim");
  return { detalhes, ignorados };
}

const brl = (v) => (typeof v === "number" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : v ?? "");
const texto = (v) => (v == null ? "" : String(v).replace(/<br\s*\/?>/gi, " / ").replace(/\s+/g, " ").trim());

function normalizar(dataset, { campos, linhas }) {
  const comChave = typeof dataset.chave === "string";
  const vistos = new Map();
  const registros = [];
  for (const valores of linhas) {
    const bruto = Object.fromEntries(campos.map((c, i) => [c, valores[i]]));
    const dados = {};
    dataset.colunas.forEach(([rotulo, , formato], i) => {
      const v = valores[i + (comChave ? 1 : 0)];
      dados[rotulo] = formato === "brl" ? brl(v) : formato === "json" ? v ?? null : texto(v);
    });
    let chave = String(comChave ? valores[0] : dataset.chave(bruto) ?? "").trim();
    if (!chave) chave = Object.values(dados).join(" | ");
    const n = (vistos.get(chave) || 0) + 1; vistos.set(chave, n);
    if (n > 1) chave = `${chave}#${n}`;                                 // mesma chave repetida no portal
    registros.push({ chave, dados });
  }
  return registros.map((r, i) => ({ ...r, ordem: i + 1 }));
}

// ---------- Supabase (PostgREST) ----------
async function supabase(method, path, body, prefer) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

async function sincronizar(nome) {
  const dataset = DATASETS[nome];
  exigir(dataset, `conjunto desconhecido "${nome}". Disponíveis: ${Object.keys(DATASETS).join(", ")}`);
  console.log(`> ${nome} ${ANO}`);
  let log = null;
  if (!DRY_RUN) [log] = await supabase("POST", "transparencia_sincronizacoes", { dataset: nome, ano: ANO, status: "executando" }, "return=representation");
  const inicio = new Date().toISOString();
  try {
    let total, registros, aviso = null, detalhes = null;
    if (dataset.baixar) {
      // Fonte de dados abertos fora do portal (ex.: Tesouro Nacional): baixa e filtra, sem navegador.
      registros = (await dataset.baixar(ANO)).map((r, i) => ({ ...r, ordem: i + 1 }));
      total = registros.length;
    } else if (dataset.extrair) {
      // Página simples: um scrape sem cache (maxAge 0) basta, sem navegador interativo.
      const res = await firecrawl("POST", "/scrape", { url: `${PORTAL}/${dataset.path}`, formats: ["markdown"], waitFor: 4000, maxAge: 0 });
      registros = dataset.extrair(res.data?.markdown || "", ANO).map((r, i) => ({ ...r, ordem: i + 1 }));
      total = registros.length;
    } else {
      // A leitura só termina no fim real da lista; diferenças com o "total" do portal viram aviso.
      // Conjuntos mensais: uma leitura por mês, somadas (a chave do registro inclui a competência).
      let coleta;
      if (dataset.filtro === "meses") {
        coleta = { campos: camposDaApi(dataset), linhas: [], total: 0, ignorados: 0 };
        for (const mes of mesesDoAno()) {
          const parte = await coletar(dataset, mes);
          coleta.linhas.push(...parte.linhas); coleta.total += parte.total ?? 0; coleta.ignorados += parte.ignorados;
        }
      } else if (dataset.filtro !== "anos") coleta = await coletar(dataset);
      if (dataset.filtro === "anos") {
        // Um registro por ano (chave = ano), todos gravados no ano corrente: uma execução atualiza a série inteira.
        coleta = { total: 0, ignorados: 0 }; registros = [];
        for (let ano = dataset.desde; ano <= ANO; ano++) {
          const parte = await coletar(dataset, ano);
          coleta.total += parte.total ?? 0; coleta.ignorados += parte.ignorados;
          registros.push(...normalizar(dataset, parte).map((r) => ({ ...r, chave: String(ano), dados: { Ano: String(ano), ...r.dados } })));
        }
        registros = registros.reverse().map((r, i) => ({ ...r, ordem: i + 1 }));
      } else registros = normalizar(dataset, coleta);
      total = coleta.total;
      const partes = [];
      if (coleta.ignorados) partes.push(`${coleta.ignorados} registro(s) não puderam ser lidos (erro da API do portal)`);
      if (total != null && registros.length + coleta.ignorados !== total) partes.push(`o portal informa ${total} registros, mas a lista dele contém ${registros.length + coleta.ignorados}`);
      // Falha no detalhe não derruba a lista: o site mostra o registro sem as abas de detalhe.
      if (dataset.detalhe && registros.length) {
        try {
          const d = await coletarDetalhes(dataset, registros.filter((r) => !dataset.detalhe.somente || dataset.detalhe.somente(r.dados)).map((r) => r.chave).filter((c) => !c.includes("#")));
          detalhes = d.detalhes;
          if (d.ignorados) partes.push(`${d.ignorados} registro(s) sem detalhe no portal`);
        } catch (e) { partes.push(`detalhes não copiados: ${e.message}`); }
      }
      if (partes.length) { aviso = partes.join("; "); console.log(`  aviso: ${aviso}`); }
    }
    if (DRY_RUN) {
      const arq = `sync-${nome}-${ANO}.json`;
      writeFileSync(arq, JSON.stringify({ total, registros, detalhes: detalhes && Object.fromEntries(detalhes) }, null, 1));
      console.log(`  simulação: ${registros.length} registros${detalhes ? ` e ${detalhes.size} detalhes` : ""} salvos em ${arq} (nada gravado no banco)`);
      return;
    }
    const gravar = async (conjunto, linhas, lote) => {
      for (let i = 0; i < linhas.length; i += lote)
        await supabase("POST", "transparencia_registros?on_conflict=dataset,ano,chave", linhas.slice(i, i + lote), "resolution=merge-duplicates,return=minimal");
      // Itens que saíram do portal: tudo deste conjunto/ano que não foi regravado nesta execução.
      await supabase("DELETE", `transparencia_registros?dataset=eq.${encodeURIComponent(conjunto)}&ano=eq.${ANO}&sincronizado_em=lt.${encodeURIComponent(inicio)}`);
    };
    const linhas = registros.map((r) => ({ dataset: nome, ano: ANO, chave: r.chave, ordem: r.ordem, dados: r.dados, sincronizado_em: inicio }));
    await gravar(nome, linhas, 500);
    if (detalhes) {
      const linhasDetalhe = registros.filter((r) => detalhes.has(r.chave))
        .map((r) => ({ dataset: `${nome}-detalhe`, ano: ANO, chave: r.chave, ordem: r.ordem, dados: detalhes.get(r.chave), sincronizado_em: inicio }));
      await gravar(`${nome}-detalhe`, linhasDetalhe, 50);
      console.log(`  ${linhasDetalhe.length} detalhes gravados`);
    }
    await supabase("PATCH", `transparencia_sincronizacoes?id=eq.${log.id}`, { status: "concluida", total_portal: total, total_gravado: linhas.length, erro: aviso, concluido_em: new Date().toISOString() });
    console.log(`  ${linhas.length} registros gravados`);
  } catch (e) {
    if (log) await supabase("PATCH", `transparencia_sincronizacoes?id=eq.${log.id}`, { status: "erro", erro: String(e.message).slice(0, 1000), concluido_em: new Date().toISOString() }).catch(() => {});
    throw e;
  }
}

const nomes = ALVO === "todos" ? Object.keys(DATASETS) : [ALVO];
// Fontes de dados abertos (ex.: Tesouro) não usam o Firecrawl.
if (nomes.some((n) => !DATASETS[n]?.baixar)) exigir(FC_KEY, "defina FIRECRAWL_API_KEY");
if (!DRY_RUN) { exigir(SUPABASE_URL, "defina TRANSPARENCIA_SUPABASE_URL"); exigir(SERVICE_KEY, "defina TRANSPARENCIA_SUPABASE_SERVICE_ROLE_KEY"); }
let falhas = 0;
for (const nome of nomes) {
  try { await sincronizar(nome); } catch (e) { falhas++; console.error(`  ERRO em ${nome}: ${e.message}`); }
}
process.exit(falhas ? 1 : 0);
