/* ==========================================================================
   APF Dashboard — Relatório de impactos sociais (HTML imprimível)

   Recebe o recorte JÁ FILTRADO pela página e abre um documento autônomo numa
   aba nova, pronto para "Salvar como PDF". Segue a mesma estrutura narrativa
   da página. A aba é aberta de forma síncrona no clique (ver report.js).
   ========================================================================== */
function gerarRelatorioImpactos({ D, F, lista, ativos, cinza, parceiras, depoisDoConvenio }) {
  const win = window.open("", "_blank");
  if (!win) {
    alert("O navegador bloqueou a abertura da nova aba. Permita pop-ups para este site e tente novamente.");
    return;
  }
  win.document.write('<!doctype html><meta charset="utf-8"><title>Gerando relatório…</title><body style="font-family:-apple-system,sans-serif;color:#3a3a3c;padding:40px;">Gerando relatório de impactos…</body>');

  const btn = document.getElementById("btn-relatorio");
  const rotulo = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Gerando…";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n = (v) => Number(v || 0).toLocaleString("pt-BR");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const link = (t, u) => (/^https?:\/\//i.test(u || "") ? `<a href="${esc(u)}">${esc(t)}</a>` : esc(t));
  const parcById = new Map(D.parceiras.map((p) => [p.id, p]));
  const profById = new Map(D.professores.map((p) => [p.id, p]));
  const odsByN = new Map(D.ods.map((o) => [o.n, o]));
  const selo = (o, est) => {
    const m = odsByN.get(o);
    return `<span class="ods" style="background:${m.cor}">${est ? "~" : ""}ODS ${o}</span>`;
  };
  const LIMITE_LISTA = 300;

  function montar(logo) {
    const depois = lista.filter((w) => depoisDoConvenio(w, ativos));

    /* filtros aplicados */
    const chips = [];
    if (F.pais) chips.push(`País: ${F.pais}`);
    if (F.parc) chips.push(`Conveniada: ${parcById.get(F.parc)?.nome || F.parc}`);
    if (F.prof) chips.push(`Professor: ${profById.get(+F.prof)?.nome || F.prof}`);
    if (F.ods) chips.push(`ODS ${F.ods} · ${odsByN.get(+F.ods)?.nome || ""}`);
    if (F.periodo) chips.push(F.periodo === "depois" ? "Desde o início do convênio" : "Antes do convênio");
    if (F.cat) chips.push(`Tipo: ${F.cat}`);
    if (F.busca && F.busca.trim()) chips.push(`Busca: ${F.busca.trim()}`);
    chips.push(F.nacional ? "Inclui conveniadas brasileiras" : "Sem conveniadas brasileiras");
    chips.push(F.gigantes ? "Inclui colaborações gigantes" : "Sem colaborações gigantes");

    /* cap. 1 */
    const porParc = parceiras.map((p) => {
      const trabs = lista.filter((w) => w.parc.includes(p.id));
      const d = trabs.filter((w) => p.ini && w.data && w.data >= p.ini).length;
      return { p, total: trabs.length, depois: d };
    }).sort((a, b) => b.total - a.total || a.p.nome.localeCompare(b.p.nome, "pt-BR"));
    const semPos = porParc.filter((x) => x.depois === 0).length;

    /* cap. 2 */
    const profs = new Map();
    for (const w of lista) for (const id of w.prof) {
      const r = profs.get(id) || { id, n: 0, parc: new Set(), ods: new Map() };
      r.n += 1;
      w.parc.filter((x) => ativos.has(x)).forEach((x) => r.parc.add(x));
      w.ods.forEach((o) => r.ods.set(o.n, (r.ods.get(o.n) || 0) + 1));
      profs.set(id, r);
    }
    const profLinhas = [...profs.values()].sort((a, b) => b.n - a.n);

    /* cap. 3 */
    const ods = new Map();
    lista.forEach((w) => w.ods.forEach((o) => {
      const r = ods.get(o.n) || { n: 0, d: 0 };
      r.n += 1;
      if (depoisDoConvenio(w, ativos)) r.d += 1;
      ods.set(o.n, r);
    }));
    const odsLinhas = [...ods.entries()].sort((a, b) => b[1].n - a[1].n);
    const comOds = lista.filter((w) => w.ods.length).length;
    const topOds = odsLinhas.slice(0, 3).map(([k]) => odsByN.get(k).nome).join(", ");

    /* cap. 4 */
    const cats = new Map();
    cinza.forEach((r) => cats.set(r.cat, (cats.get(r.cat) || 0) + 1));
    const catLinhas = [...cats.entries()].sort((a, b) => b[1] - a[1]);
    const odsCinza = new Map();
    cinza.forEach((r) => r.ods.forEach((o) => odsCinza.set(o.n, (odsCinza.get(o.n) || 0) + 1)));
    const prioridade = { "Relatório": 0, "Tese": 1, "Dados e software": 2, "Dissertação": 3, "Livro e capítulo": 4, "Preprint": 5, "Evento": 6, "Outros": 7, "TCC": 8 };
    const cinzaOrd = cinza.slice().sort((a, b) => (prioridade[a.cat] ?? 9) - (prioridade[b.cat] ?? 9) || (b.ano || 0) - (a.ano || 0));

    /* cap. 5 */
    const ids = new Set(lista.map((w) => w.id));
    const titulos = new Map(D.trabalhos.map((w) => [w.id, w]));
    const citantes = D.uso.citantes.filter((c) => c.cita.some((i) => ids.has(i)));

    const trabOrd = lista.slice().sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    const hoje = new Date().toLocaleDateString("pt-BR");
    const faixa = D.metodo.calibracao && D.metodo.calibracao.faixas[String(D.metodo.min_sim_titulo)];

    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
<title>Relatório de Impactos Sociais · UEA × Conveniadas</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #2b2f2d; margin: 0 auto; max-width: 980px; padding: 32px; font-size: 13px; line-height: 1.5; }
  a { color: #0b6b45; }
  .acoes { position: sticky; top: 0; background: #fff; padding: 8px 0; text-align: right; }
  .acoes button { background: #1f8a5f; color: #fff; border: 0; border-radius: 999px; padding: 8px 18px; font-size: 13px; cursor: pointer; }
  header.topo { display: flex; gap: 18px; align-items: center; border-bottom: 2px solid #1f8a5f; padding-bottom: 14px; }
  header.topo img { height: 52px; }
  h1 { font-size: 22px; margin: 0; color: #0b3d2b; }
  .meta { color: #66716b; font-size: 12px; }
  .chips { margin: 14px 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .chips span { background: #eef8f2; color: #0b3d2b; border-radius: 999px; padding: 3px 10px; font-size: 11px; }
  .enigma { font-size: 15px; font-weight: 600; color: #0b3d2b; margin: 16px 0; }
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 14px 0 6px; }
  .stats div { border: 1px solid #cdeedd; border-radius: 10px; padding: 10px; }
  .stats b { display: block; font-size: 20px; color: #0b3d2b; }
  .stats span { font-size: 10.5px; color: #66716b; }
  section { margin-top: 26px; }
  .cap { color: #1f8a5f; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  h2 { font-size: 17px; margin: 2px 0 8px; color: #0b3d2b; break-after: avoid; }
  h3 { font-size: 13px; margin: 14px 0 6px; color: #0b3d2b; break-after: avoid; }
  .resp { background: #f6faf8; border-left: 3px solid #1f8a5f; padding: 8px 12px; margin: 0 0 10px; }
  .nota { color: #66716b; font-size: 11.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  thead { display: table-header-group; }
  th { text-align: left; border-bottom: 1.5px solid #9fd9bb; padding: 5px 6px; color: #0b3d2b; }
  td { border-bottom: 1px solid #e6efea; padding: 5px 6px; vertical-align: top; }
  tr { break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ods { display: inline-block; color: #fff; border-radius: 4px; padding: 0 5px; font-size: 10px; margin: 0 2px 2px 0; white-space: nowrap; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ul { padding-left: 18px; margin: 6px 0; }
  .aviso { border: 1px solid #eda100; background: #fff8e8; border-radius: 8px; padding: 8px 12px; margin: 10px 0; }
  footer { margin-top: 28px; border-top: 1px solid #cdeedd; padding-top: 10px; color: #66716b; font-size: 11px; }
  @media print { .acoes { display: none; } body { padding: 0; max-width: none; } a { color: inherit; text-decoration: none; } }
</style></head><body>
<div class="acoes"><button onclick="window.print()">Salvar como PDF</button></div>
<header class="topo">
  ${logo ? `<img src="${logo}" alt="PROPESP UEA" />` : ""}
  <div><h1>Relatório de Impactos Sociais</h1><div class="meta">UEA × universidades conveniadas · gerado em ${esc(hoje)} · dados coletados em ${esc((D.coleta_em || "").split("-").reverse().join("/"))}</div></div>
</header>
<div class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join("")}</div>
<p class="enigma">Os convênios da UEA estão gerando pesquisa em conjunto que chega à sociedade?</p>
<div class="aviso"><b>Como ler:</b> ODS indica tema, não efeito. Este relatório só trata como evidência de uso o que aparece no capítulo 5. Ele usa apenas fontes abertas, que cobrem pouco as políticas públicas e a mídia.</div>
<div class="stats">
  <div><b>${n(lista.length)}</b><span>Coautorias</span></div>
  <div><b>${n(depois.length)}</b><span>Desde o convênio</span></div>
  <div><b>${n(profLinhas.length)}</b><span>Professores identificados</span></div>
  <div><b>${n(odsLinhas.length)}</b><span>ODS relacionados</span></div>
  <div><b>${n(cinza.length)}</b><span>Documentos de lit. cinzenta</span></div>
</div>

<section><div class="cap">Capítulo 1</div><h2>Os convênios geram coautoria?</h2>
<p class="resp">Das ${n(lista.length)} coautorias do recorte, <b>${n(depois.length)}</b> saíram desde o início do convênio. <b>${n(semPos)} de ${n(porParc.length)}</b> conveniadas ainda não têm nenhuma nesse período.</p>
<table><thead><tr><th>Conveniada</th><th>País</th><th>Início do acordo</th><th class="num">Antes</th><th class="num">Desde o convênio</th><th class="num">Total</th></tr></thead>
<tbody>${porParc.map((x) => `<tr><td>${esc(x.p.nome)}</td><td>${esc(x.p.pais)}</td><td>${esc((x.p.ini || "sem data").split("-").reverse().join("/"))}</td><td class="num">${n(x.total - x.depois)}</td><td class="num">${n(x.depois)}</td><td class="num">${n(x.total)}</td></tr>`).join("") || '<tr><td colspan="6">Sem conveniadas neste recorte.</td></tr>'}</tbody></table>
${D.sem_openalex.length && !F.parc ? `<p class="nota">Não medidos, por não terem cadastro no OpenAlex: ${D.sem_openalex.map((s) => esc(s.instituicao)).join("; ")}.</p>` : ""}
</section>

<section><div class="cap">Capítulo 2</div><h2>Quais professores sustentam essas parcerias?</h2>
<p class="resp"><b>${n(profLinhas.length)}</b> de ${n(D.n_professores_total)} professores do painel aparecem nas coautorias. ${n(lista.filter((w) => !w.prof.length).length)} de ${n(lista.length)} trabalhos têm autor da UEA fora da lista, então esta contagem é um piso.</p>
<table><thead><tr><th>Professor</th><th>PPG</th><th class="num">Coautorias</th><th>Conveniadas</th><th>ODS mais frequentes</th></tr></thead>
<tbody>${profLinhas.map((r) => {
    const p = profById.get(r.id);
    return `<tr><td>${esc(p.nome)}</td><td>${esc((p.programas || []).join(", "))}</td><td class="num">${n(r.n)}</td><td>${esc([...r.parc].map((x) => parcById.get(x).nome).join("; "))}</td><td>${[...r.ods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => selo(k)).join("")}</td></tr>`;
  }).join("") || '<tr><td colspan="5">Nenhum professor identificado neste recorte.</td></tr>'}</tbody></table>
</section>

<section><div class="cap">Capítulo 3</div><h2>A quais ODS essa produção se relaciona?</h2>
<p class="resp">${topOds ? `Os mais frequentes são <b>${esc(topOds)}</b>. ` : ""}${n(comOds)} de ${n(lista.length)} trabalhos têm algum ODS.</p>
<table><thead><tr><th>ODS</th><th class="num">Trabalhos</th><th class="num">% do recorte</th><th class="num">Desde o convênio</th><th class="num">% na produção total da UEA</th></tr></thead>
<tbody>${odsLinhas.map(([k, v]) => `<tr><td>${selo(k)} ${esc(odsByN.get(k).nome)}</td><td class="num">${n(v.n)}</td><td class="num">${pct(v.n, lista.length)}%</td><td class="num">${n(v.d)}</td><td class="num">${pct(D.linha_base.ods[k] || 0, D.linha_base.total)}%</td></tr>`).join("") || '<tr><td colspan="5">Sem ODS neste recorte.</td></tr>'}</tbody></table>
<h3>Publicações em parceria${trabOrd.length > LIMITE_LISTA ? ` (as ${LIMITE_LISTA} mais recentes de ${n(trabOrd.length)})` : ""}</h3>
<table><thead><tr><th>Título</th><th class="num">Ano</th><th>Conveniadas</th><th>Professores</th><th>ODS</th></tr></thead>
<tbody>${trabOrd.slice(0, LIMITE_LISTA).map((w) => `<tr><td>${link(w.t, w.doi || `https://openalex.org/${w.id}`)}</td><td class="num">${w.ano || ""}</td><td>${esc(w.parc.filter((x) => ativos.has(x)).map((x) => parcById.get(x).nome).join("; "))}</td><td>${esc(w.prof.map((i) => profById.get(i)?.nome).filter(Boolean).join("; ")) || "Não identificado"}</td><td>${w.ods.map((o) => selo(o.n)).join("")}</td></tr>`).join("") || '<tr><td colspan="5">Sem publicações neste recorte.</td></tr>'}</tbody></table>
</section>

<section><div class="cap">Capítulo 4</div><h2>O que a UEA produz fora dos periódicos?</h2>
<p class="resp"><b>${n(cinza.length)}</b> documentos no recorte${F.cinza === "toda" ? ", considerando toda a produção da UEA" : " ligado às parcerias"}. Eles mostram o que foi produzido, não quem usou.</p>
<table><thead><tr><th>Tipo</th><th class="num">Documentos</th><th class="num">%</th></tr></thead>
<tbody>${catLinhas.map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num">${n(v)}</td><td class="num">${pct(v, cinza.length)}%</td></tr>`).join("") || '<tr><td colspan="3">Sem registros neste recorte.</td></tr>'}</tbody></table>
${odsCinza.size ? `<h3>ODS da literatura cinzenta</h3><table><thead><tr><th>ODS</th><th class="num">Documentos</th></tr></thead><tbody>${[...odsCinza.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${selo(k)} ${esc(odsByN.get(k).nome)}</td><td class="num">${n(v)}</td></tr>`).join("")}</tbody></table>` : ""}
<h3>Documentos${cinzaOrd.length > LIMITE_LISTA ? ` (${LIMITE_LISTA} de ${n(cinzaOrd.length)}, com relatórios, teses e dados primeiro)` : ""}</h3>
<table><thead><tr><th>Título</th><th class="num">Ano</th><th>Tipo</th><th>Fonte</th><th>ODS</th></tr></thead>
<tbody>${cinzaOrd.slice(0, LIMITE_LISTA).map((r) => `<tr><td>${link(r.t, r.url)}</td><td class="num">${r.ano || ""}</td><td>${esc(r.cat)}</td><td>${esc(r.fontes.join(", "))}</td><td>${r.ods.map((o) => selo(o.n, r.e)).join("")}</td></tr>`).join("") || '<tr><td colspan="5">Sem registros neste recorte.</td></tr>'}</tbody></table>
<p class="nota">~ ODS estimado pelo título, não atribuído pela fonte.</p>
</section>

<section><div class="cap">Capítulo 5</div><h2>Quem usou essa pesquisa fora da academia?</h2>
<p class="resp"><b>Resposta parcial.</b> ${n(citantes.length)} ${citantes.length === 1 ? "relatório cita" : "relatórios citam"} trabalhos deste recorte, e ${n(citantes.filter((c) => c.cita.some((i) => ids.has(i) && depoisDoConvenio(titulos.get(i), ativos))).length)} com trabalho publicado desde o início do convênio. As fontes abertas cobrem pouco as políticas públicas e a mídia, então este número não mede o impacto total.</p>
${citantes.length ? `<table><thead><tr><th>Relatório</th><th class="num">Ano</th><th>Origem</th><th>Trabalho citado</th></tr></thead><tbody>${citantes.map((c) => `<tr><td>${link(c.t, c.url)}</td><td class="num">${c.ano || ""}</td><td>${esc([c.fonte, ...c.inst].filter(Boolean).join("; "))}</td><td>${c.cita.filter((i) => ids.has(i)).map((i) => `${esc(titulos.get(i).t)} (${titulos.get(i).ano || "s/d"}, ${depoisDoConvenio(titulos.get(i), ativos) ? "desde o convênio" : "anterior ao convênio"})`).join("<br>")}</td></tr>`).join("")}</tbody></table>` : ""}
</section>

<section><div class="cap">Bastidores</div><h2>Método e limites</h2>
<ul>
  <li>Coautoria: trabalhos no OpenAlex com autores ligados à UEA e à conveniada.</li>
  <li>Período: a data de publicação é comparada com o início do acordo mais antigo. Coincidência no tempo não prova causa.</li>
  <li>ODS das coautorias: classificador automático do OpenAlex, com pontuação acima de ${String(D.metodo.limiar_ods_openalex).replace(".", ",")}. Um trabalho pode ter mais de um ODS.</li>
  ${faixa ? `<li>ODS estimado: similaridade entre título e descrição do ODS (Sentence-BERT), com ${pct(faixa.concordancia, 1)}% de concordância com o OpenAlex em ${n(faixa.n)} trabalhos testados. Títulos que citam a Amazônia tendem a cair em Vida terrestre, então use como indicação, não como rótulo definitivo.</li>` : ""}
  <li>Professores: ligação por ORCID ou nome exato, apenas entre os ${n(D.n_professores_total)} nomes do painel.</li>
  <li>Literatura cinzenta: ${esc(Object.entries(D.cinza.fontes).map(([k, v]) => `${k} (${n(v.aproveitados)})`).join(", "))}, antes de remover duplicatas.</li>
  ${(D.uso.consultadas || []).filter((c) => c.status === "ok").map((c) => `<li>${esc(c.fonte)}: consultado, ${n(c.n)} ${c.n === 1 ? "conjunto de dados" : "conjuntos de dados"} da UEA no catálogo.</li>`).join("")}
</ul></section>
<footer>Gerado automaticamente pelo Painel de Matchs de Convênios — PROPESP/UEA.</footer>
</body></html>`;
  }

  fetchLogo()
    .then((logo) => { win.document.open(); win.document.write(montar(logo)); win.document.close(); })
    .catch((err) => {
      win.document.open();
      win.document.write(`<!doctype html><meta charset="utf-8"><title>Erro</title><body style="font-family:-apple-system,sans-serif;color:#b00020;padding:40px;">Erro ao gerar o relatório: ${esc(err && err.message ? err.message : String(err))}</body>`);
      win.document.close();
      console.error("gerarRelatorioImpactos falhou:", err);
    })
    .finally(() => { btn.disabled = false; btn.textContent = rotulo; });

  async function fetchLogo() {
    try {
      const svg = await fetch("image/propespuea.svg").then((r) => r.text());
      return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    } catch (e) {
      return null;
    }
  }
}
