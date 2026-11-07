/* ==========================================================================
   APF Dashboard — Monitoramento de impactos sociais

   Dados: ../data/impacto.json (etl/impacto_coleta.py + etl/impacto_export.py)
   Regra de leitura: ODS é "tema relacionado"; "impacto" só com evidência de uso
   fora da academia (capítulo 5). Só fontes gratuitas: o que elas não cobrem é limite da medida, não ausência de impacto.
   ========================================================================== */
(async function () {
  const D = await fetch("../data/impacto.json", { cache: "no-cache" }).then((r) => r.json());
  initThemeToggle();

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // links vêm de APIs externas: só http(s)
  const urlSegura = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const plural = (n, um, varios) => `${fmt(n)} ${n === 1 ? um : varios}`;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  const parcById = new Map(D.parceiras.map((p) => [p.id, p]));
  const odsByN = new Map(D.ods.map((o) => [o.n, o]));
  const profById = new Map(D.professores.map((p) => [p.id, p]));
  const dataBR = (d) => (d ? d.split("-").reverse().join("/") : "sem data");

  /* ---------- estado ---------- */
  const q = new URLSearchParams(location.search);
  const F = {
    pais: q.get("pais") || "", parc: q.get("parc") || "", prof: q.get("prof") || "", ods: q.get("ods") || "",
    periodo: q.get("periodo") || "", nacional: q.get("nacional") === "1", gigantes: q.get("gigantes") === "1",
    cinza: q.get("cinza") || "ligada", cat: q.get("cat") || "", busca: "",
  };
  const limites = { c3: 15, c4: 15, c2: 12 };

  /* ---------- recortes ---------- */
  function parceirasAtivas() {
    return D.parceiras.filter((p) =>
      (F.nacional || !p.nacional) && (!F.pais || p.pais === F.pais) && (!F.parc || p.id === F.parc));
  }
  // o trabalho é "depois" se saiu a partir do início do acordo com alguma conveniada ativa
  function depoisDoConvenio(w, ativos) {
    return w.parc.some((id) => ativos.has(id) && parcById.get(id).ini && w.data && w.data >= parcById.get(id).ini);
  }
  function recorteBase() {
    const ativos = new Set(parceirasAtivas().map((p) => p.id));
    return {
      ativos,
      lista: D.trabalhos.filter((w) => {
        if (!w.parc.some((id) => ativos.has(id))) return false;
        if (w.gig && !F.gigantes) return false;
        if (F.prof && !w.prof.includes(+F.prof)) return false;
        if (F.periodo === "depois" && !depoisDoConvenio(w, ativos)) return false;
        if (F.periodo === "antes" && depoisDoConvenio(w, ativos)) return false;
        return true;
      }),
    };
  }
  const temOds = (w, n) => w.ods.some((o) => o.n === n);

  function recorteCinza(base) {
    const profsDoRecorte = new Set(base.flatMap((w) => w.prof));
    return D.cinza.registros.filter((r) => {
      if (F.prof && !r.prof.includes(+F.prof)) return false;
      if (F.cinza === "direta") {
        const ativos = new Set(parceirasAtivas().map((p) => p.id));
        if (!r.parc.some((id) => ativos.has(id))) return false;
      } else if (F.cinza === "ligada") {
        const ativos = new Set(parceirasAtivas().map((p) => p.id));
        if (!r.parc.some((id) => ativos.has(id)) && !r.prof.some((id) => profsDoRecorte.has(id))) return false;
      }
      return true;
    });
  }

  /* ---------- filtros ---------- */
  const el = (id) => document.getElementById(id);
  const opcoes = (sel, itens, vazio, atual) => {
    sel.innerHTML = `<option value="">${esc(vazio)}</option>` + itens.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
    sel.value = itens.some(([v]) => String(v) === String(atual)) ? atual : "";
    return sel.value;
  };
  function preencherFiltros() {
    const visiveis = D.parceiras.filter((p) => F.nacional || !p.nacional);
    F.pais = opcoes(el("f-pais"), [...new Set(visiveis.map((p) => p.pais))].sort((a, b) => a.localeCompare(b, "pt-BR")).map((p) => [p, p]), "Todos os países", F.pais);
    F.parc = opcoes(el("f-parc"), visiveis.filter((p) => !F.pais || p.pais === F.pais).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((p) => [p.id, p.nome]), "Todas as conveniadas", F.parc);
    F.prof = opcoes(el("f-prof"), [...D.professores].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((p) => [p.id, p.nome]), "Todos os professores", F.prof);
    F.ods = opcoes(el("f-ods"), D.ods.map((o) => [o.n, `${o.n} · ${o.nome}`]), "Todos os ODS", F.ods);
    F.cat = opcoes(el("f-cat"), [...new Set(D.cinza.registros.map((r) => r.cat))].sort((a, b) => a.localeCompare(b, "pt-BR")).map((c) => [c, c]), "Todos os tipos", F.cat);
    el("f-periodo").value = F.periodo;
    el("f-nacional").checked = F.nacional;
    el("f-gigantes").checked = F.gigantes;
    el("f-cinza").value = F.cinza;
  }
  function syncURL() {
    const u = new URLSearchParams();
    for (const k of ["pais", "parc", "prof", "ods", "periodo"]) if (F[k]) u.set(k, F[k]);
    if (F.nacional) u.set("nacional", "1");
    if (F.gigantes) u.set("gigantes", "1");
    if (F.cinza !== "ligada") u.set("cinza", F.cinza);
    if (F.cat) u.set("cat", F.cat);
    history.replaceState(null, "", u.toString() ? "?" + u : location.pathname);
  }
  function aplicar() { preencherFiltros(); syncURL(); limites.c3 = 15; limites.c4 = 15; limites.c2 = 12; render(); }
  for (const [id, k] of [["f-pais", "pais"], ["f-parc", "parc"], ["f-prof", "prof"], ["f-ods", "ods"], ["f-periodo", "periodo"], ["f-cinza", "cinza"], ["f-cat", "cat"]]) {
    el(id).addEventListener("change", (e) => { F[k] = e.target.value; aplicar(); });
  }
  el("f-nacional").addEventListener("change", (e) => { F.nacional = e.target.checked; aplicar(); });
  el("f-gigantes").addEventListener("change", (e) => { F.gigantes = e.target.checked; aplicar(); });
  el("f-busca").addEventListener("input", debounce((e) => { F.busca = e.target.value; limites.c4 = 15; renderCinza(recorteBase().lista); }, 200));
  el("f-limpar").addEventListener("click", () => {
    Object.assign(F, { pais: "", parc: "", prof: "", ods: "", periodo: "", nacional: false, gigantes: false, cinza: "ligada", cat: "", busca: "" });
    el("f-busca").value = "";
    aplicar();
  });

  /* ---------- peças visuais ---------- */
  const resposta = (id, estado, texto) => {
    const rotulo = { respondida: "Respondida", parcial: "Parcial", aguardando: "Aguardando dados" }[estado];
    el(id).innerHTML = `<span class="imp-estado imp-estado--${estado}">${rotulo}</span><p>${texto}</p>`;
  };
  const tituloLink = (t, url) => {
    const u = urlSegura(url);
    return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t);
  };
  const seloOds = (o, estimado) => {
    const m = odsByN.get(o.n);
    return `<span class="tag tag--ods" style="background:${m.cor}" title="ODS ${o.n} · ${esc(m.nome)}${estimado ? " (estimado pelo título)" : ""}">${estimado ? "~" : ""}ODS ${o.n}</span>`;
  };
  const verMais = (chave, resta) => (resta > 0 ? `<button type="button" class="btn btn--ghost imp-mais" data-mais="${chave}">Mostrar mais ${fmt(Math.min(resta, 30))} (restam ${fmt(resta)})</button>` : "");

  function barrasOds(contagem, opts = {}) {
    const itens = D.ods.map((o) => ({ ...o, v: contagem.get(o.n) || 0 })).filter((o) => o.v > 0).sort((a, b) => b.v - a.v || a.n - b.n);
    if (!itens.length) return `<div class="empty-hint">${opts.vazio || "Sem trabalhos com ODS neste recorte."}</div>`;
    const max = itens[0].v;
    return `<div class="imp-odsbars">${itens.map((o) => {
      const base = opts.referencia ? ` · UEA ${pct(opts.referencia.get(o.n) || 0, opts.refTotal)}%` : "";
      const tag = opts.clicavel ? "button" : "div";
      return `<${tag} ${opts.clicavel ? `type="button" data-odsbar="${o.n}" aria-pressed="${String(F.ods) === String(o.n)}"` : ""} class="imp-odsbar${String(F.ods) === String(o.n) ? " is-selected" : ""}"
          data-tip="<b>ODS ${o.n} · ${esc(o.nome)}</b><br>${fmt(o.v)} ${o.v === 1 ? "trabalho" : "trabalhos"} (${pct(o.v, opts.total)}% do recorte)${base}">
          <img src="${o.imagem}" alt="ODS ${o.n}" loading="lazy" />
          <span class="imp-odsbar__nome">${o.n}. ${esc(o.nome)}</span>
          <span class="imp-odsbar__trilha"><i style="width:${Math.max(2, (o.v / max) * 100)}%"></i></span>
          <span class="imp-odsbar__val">${fmt(o.v)}<small>${pct(o.v, opts.total)}%${base}</small></span>
        </${tag}>`;
    }).join("")}</div>`;
  }

  /* ---------- capítulo 1 ---------- */
  function renderCap1(lista, ativos) {
    const linhas = parceirasAtivas().map((p) => {
      const trabs = lista.filter((w) => w.parc.includes(p.id));
      const depois = trabs.filter((w) => p.ini && w.data && w.data >= p.ini).length;
      return { p, total: trabs.length, depois, antes: trabs.length - depois };
    });
    const comDado = linhas.filter((l) => l.total > 0).sort((a, b) => b.total - a.total || a.p.nome.localeCompare(b.p.nome));
    const zeradas = linhas.filter((l) => l.total === 0);
    const semPosConvenio = linhas.filter((l) => l.depois === 0);
    const unicosDepois = lista.filter((w) => depoisDoConvenio(w, ativos)).length;

    const max = comDado.length ? comDado[0].total : 0;
    el("c1-barras").innerHTML = comDado.length ? `<div class="imp-barras">${comDado.map((l) => `
      <button type="button" class="imp-barra" data-parc="${l.p.id}"
        data-tip="<b>${esc(l.p.nome)}</b> · ${esc(l.p.pais)}<br>Convênio desde ${dataBR(l.p.ini)}<br>Antes: ${fmt(l.antes)} · Desde o convênio: ${fmt(l.depois)}">
        <span class="imp-barra__nome">${esc(l.p.nome)}<small>${esc(l.p.pais)} · desde ${l.p.ini ? l.p.ini.slice(0, 4) : "s/d"}</small></span>
        <span class="imp-barra__trilha">
          ${l.antes ? `<i class="imp-seg imp-seg--antes" style="width:${(l.antes / max) * 100}%"></i>` : ""}
          ${l.depois ? `<i class="imp-seg imp-seg--depois" style="width:${(l.depois / max) * 100}%"></i>` : ""}
        </span>
        <span class="imp-barra__val">${fmt(l.depois)}<small>de ${fmt(l.total)}</small></span>
      </button>`).join("")}</div>` : `<div class="empty-hint">Nenhuma coautoria neste recorte.</div>`;

    el("c1-zeradas").innerHTML = (zeradas.length ? `<b>${plural(zeradas.length, "conveniada sem coautoria", "conveniadas sem coautoria")} no recorte:</b> ${zeradas.map((l) => esc(l.p.nome)).join("; ")}.` : "") +
      (D.sem_openalex.length && !F.parc ? `<br><b>${fmt(D.sem_openalex.length)} acordos não puderam ser medidos</b> por não terem cadastro no OpenAlex: ${D.sem_openalex.map((s) => esc(s.instituicao)).join("; ")}.` : "");

    if (!lista.length) return resposta("r1", "respondida", "Não há coautoria registrada neste recorte.");
    const n = linhas.length;
    resposta("r1", "respondida", F.periodo === "antes"
      ? `Neste recorte, há <b>${plural(lista.length, "coautoria anterior", "coautorias anteriores")}</b> ao início dos acordos.`
      : `<b>${unicosDepois === 0 ? "Ainda não." : semPosConvenio.length > n / 2 ? "Sim, mas em poucas conveniadas." : "Sim."}</b> Das ${plural(lista.length, "coautoria", "coautorias")} do recorte, <b>${fmt(unicosDepois)}</b> ${unicosDepois === 1 ? "saiu" : "saíram"} desde o início do convênio. <b>${fmt(semPosConvenio.length)} de ${fmt(n)}</b> conveniadas ainda não têm nenhuma nesse período.`);
  }

  /* ---------- capítulo 2 ---------- */
  function renderCap2(lista, ativos) {
    const porProf = new Map();
    for (const w of lista) {
      for (const id of w.prof) {
        const r = porProf.get(id) || { id, trabs: 0, parc: new Set(), ods: new Map() };
        r.trabs += 1;
        w.parc.filter((x) => ativos.has(x)).forEach((x) => r.parc.add(x));
        w.ods.forEach((o) => r.ods.set(o.n, (r.ods.get(o.n) || 0) + 1));
        porProf.set(id, r);
      }
    }
    const cinzaPorProf = new Map();
    for (const r of D.cinza.registros) r.prof.forEach((id) => cinzaPorProf.set(id, (cinzaPorProf.get(id) || 0) + 1));
    const linhas = [...porProf.values()].sort((a, b) => b.trabs - a.trabs);
    const semLigacao = lista.filter((w) => !w.prof.length).length;

    el("c2-tabela").innerHTML = linhas.length ? `<table class="imp-tabela">
      <thead><tr><th>Professor</th><th>PPG</th><th class="num">Coautorias</th><th>Conveniadas</th><th>ODS mais frequentes</th><th class="num">Lit. cinzenta</th></tr></thead>
      <tbody>${linhas.slice(0, limites.c2).map((r) => {
        const p = profById.get(r.id);
        const ods = [...r.ods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => seloOds({ n })).join("");
        const nomes = [...r.parc].filter((x) => parcById.get(x)).map((x) => parcById.get(x).nome);
        return `<tr><td><button type="button" class="imp-link" data-prof="${r.id}">${esc(p.nome)}</button></td>
          <td>${esc((p.programas || []).join(", "))}</td><td class="num">${fmt(r.trabs)}</td>
          <td title="${esc(nomes.join("; "))}">${esc(nomes.slice(0, 2).join("; "))}${nomes.length > 2 ? ` +${nomes.length - 2}` : ""}</td>
          <td>${ods}</td><td class="num">${fmt(cinzaPorProf.get(r.id) || 0)}</td></tr>`;
      }).join("")}</tbody></table>${verMais("c2", linhas.length - limites.c2)}` : `<div class="empty-hint">Nenhum professor da lista do painel neste recorte.</div>`;

    if (!lista.length) return resposta("r2", "respondida", "Sem coautorias neste recorte.");
    const top3 = linhas.slice(0, 3).reduce((s, r) => s + r.trabs, 0);
    const ligadas = lista.length - semLigacao;
    resposta("r2", "parcial", linhas.length
      ? `<b>${plural(linhas.length, "professor", "professores")}</b> do painel, de ${fmt(D.n_professores_total)}, ${linhas.length === 1 ? "aparece" : "aparecem"} nas coautorias. Os três mais ativos somam ${fmt(top3)} participações. <b>${fmt(semLigacao)} de ${fmt(lista.length)}</b> trabalhos têm autor da UEA que não reconhecemos na lista, como estudantes, egressos ou nomes grafados de outra forma.`
      : `Nenhum dos ${fmt(lista.length)} trabalhos pôde ser ligado a um professor da lista do painel.`);
    void ligadas;
  }

  /* ---------- capítulo 3 ---------- */
  function renderCap3(lista, ativos) {
    const contagem = new Map();
    let comOds = 0;
    for (const w of lista) {
      if (w.ods.length) comOds += 1;
      w.ods.forEach((o) => contagem.set(o.n, (contagem.get(o.n) || 0) + 1));
    }
    const refMap = new Map(Object.entries(D.linha_base.ods).map(([k, v]) => [+k, v]));
    el("c3-ods").innerHTML = barrasOds(contagem, { clicavel: true, total: lista.length, referencia: refMap, refTotal: D.linha_base.total });

    // matriz conveniada × ODS
    const odsVisiveis = D.ods.filter((o) => contagem.get(o.n));
    const parcs = parceirasAtivas().map((p) => {
      const trabs = lista.filter((w) => w.parc.includes(p.id));
      const porOds = new Map();
      trabs.forEach((w) => w.ods.forEach((o) => porOds.set(o.n, (porOds.get(o.n) || 0) + 1)));
      return { p, n: trabs.length, porOds };
    }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 15);
    const maxCel = Math.max(1, ...parcs.flatMap((x) => [...x.porOds.values()]));
    el("c3-matriz").innerHTML = parcs.length && odsVisiveis.length ? `<table class="ods-matrix">
      <thead><tr><th class="ods-matrix__inst"></th>${odsVisiveis.map((o) => `<th class="ods-matrix__ods${String(F.ods) === String(o.n) ? " is-selected" : ""}" title="ODS ${o.n} · ${esc(o.nome)}" data-odsbar="${o.n}"><img src="${o.imagem}" alt="ODS ${o.n}" loading="lazy" /></th>`).join("")}</tr></thead>
      <tbody>${parcs.map((x) => `<tr><th class="ods-matrix__inst" title="${esc(x.p.nome)}">${esc(x.p.nome)}</th>${odsVisiveis.map((o) => {
        const v = x.porOds.get(o.n) || 0;
        return `<td style="--a:${v ? Math.round(18 + (v / maxCel) * 62) : 0}%" data-tip="<b>${esc(x.p.nome)}</b><br>ODS ${o.n} · ${esc(o.nome)}: ${fmt(v)}">${v || ""}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table>` : `<div class="empty-hint">Sem dados para este recorte.</div>`;

    // lista
    const filtrada = (F.ods ? lista.filter((w) => temOds(w, +F.ods)) : lista).slice().sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    el("c3-conta").textContent = plural(filtrada.length, "publicação", "publicações");
    el("c3-lista").innerHTML = filtrada.length ? `<table class="imp-tabela">
      <thead><tr><th>Título</th><th class="num">Ano</th><th>Conveniadas</th><th>Professores</th><th>ODS</th><th class="num" title="Citações acadêmicas: mostram alcance científico, não impacto social">Citações</th></tr></thead>
      <tbody>${filtrada.slice(0, limites.c3).map((w) => {
        const parc = w.parc.filter((x) => ativos.has(x)).map((x) => parcById.get(x).nome);
        const profs = w.prof.map((id) => profById.get(id)?.nome).filter(Boolean);
        const url = w.doi || `https://openalex.org/${w.id}`;
        const aposAcordo = depoisDoConvenio(w, ativos);
        return `<tr><td class="imp-titulo">${tituloLink(w.t, url)}${aposAcordo ? ' <span class="imp-pos" title="Publicado desde o início do convênio">pós-convênio</span>' : ""}${w.gig ? ' <span class="imp-pos imp-pos--gig">colaboração gigante</span>' : ""}<small>${esc(w.fonte || "")}</small></td>
          <td class="num">${w.ano || ""}</td><td>${esc(parc.join("; "))}</td>
          <td>${esc(profs.join("; ")) || '<span class="muted">Não identificado</span>'}</td>
          <td>${w.ods.map((o) => seloOds(o)).join("") || '<span class="muted">—</span>'}</td><td class="num">${fmt(w.cit)}</td></tr>`;
      }).join("")}</tbody></table>${verMais("c3", filtrada.length - limites.c3)}` : `<div class="empty-hint">Nenhuma publicação neste recorte.</div>`;

    if (!lista.length) return resposta("r3", "respondida", "Sem coautorias neste recorte.");
    const top = [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${esc(odsByN.get(n).nome)} (${fmt(v)})`);
    resposta("r3", "respondida", `<b>${top.length ? top.join(", ") : "Nenhum ODS"}</b> ${top.length === 1 ? "é o mais frequente" : "são os mais frequentes"}. ${fmt(comOds)} de ${fmt(lista.length)} trabalhos têm algum ODS, o que mostra tema, não efeito sobre a sociedade.`);
  }

  /* ---------- capítulo 4 ---------- */
  function renderCinza(base) {
    const pendente = D.metodo.ods_estimado_pendente;
    let regs = recorteCinza(base);
    const escopo = regs;
    if (F.ods) regs = regs.filter((r) => r.ods.some((o) => o.n === +F.ods));
    if (F.cat) regs = regs.filter((r) => r.cat === F.cat);
    if (F.busca.trim()) { const b = norm(F.busca); regs = regs.filter((r) => norm(r.t).includes(b)); }

    const porCat = new Map();
    regs.forEach((r) => porCat.set(r.cat, (porCat.get(r.cat) || 0) + 1));
    const cats = [...porCat.entries()].sort((a, b) => b[1] - a[1]);
    el("c4-cat").innerHTML = cats.length ? `<div class="imp-barras imp-barras--simples">${cats.map(([c, v]) => `
      <button type="button" class="imp-barra" data-cat="${esc(c)}" data-tip="<b>${esc(c)}</b><br>${fmt(v)} registros (${pct(v, regs.length)}%)">
        <span class="imp-barra__nome">${esc(c)}</span>
        <span class="imp-barra__trilha"><i class="imp-seg imp-seg--depois" style="width:${(v / cats[0][1]) * 100}%"></i></span>
        <span class="imp-barra__val">${fmt(v)}</span>
      </button>`).join("")}</div>` : `<div class="empty-hint">Nenhum registro neste recorte.</div>`;

    const contagem = new Map();
    regs.forEach((r) => r.ods.forEach((o) => contagem.set(o.n, (contagem.get(o.n) || 0) + 1)));
    el("c4-ods").innerHTML = pendente && !contagem.size
      ? `<div class="empty-hint">Classificação por ODS em andamento. Os ODS estimados aparecem quando ela terminar.</div>`
      : barrasOds(contagem, { total: regs.length, vazio: "Nenhum registro com ODS neste recorte." });
    el("c4-ods-nota").textContent = "~ estimado pelo título";

    el("c4-conta").textContent = plural(regs.length, "registro", "registros");
    const ord = regs.slice().sort((a, b) => (b.ano || 0) - (a.ano || 0));
    el("c4-lista").innerHTML = ord.length ? `<table class="imp-tabela">
      <thead><tr><th>Título</th><th class="num">Ano</th><th>Tipo</th><th>Fonte</th><th>Ligação com a UEA e parcerias</th><th>ODS</th></tr></thead>
      <tbody>${ord.slice(0, limites.c4).map((r) => {
        const parc = r.parc.map((x) => parcById.get(x)?.nome).filter(Boolean);
        const profs = r.prof.map((id) => profById.get(id)?.nome).filter(Boolean);
        return `<tr><td class="imp-titulo">${tituloLink(r.t, r.url)}</td><td class="num">${r.ano || ""}</td><td>${esc(r.cat)}</td><td>${esc(r.fontes.join(", "))}</td>
          <td>${esc([...parc, ...profs].join("; ")) || '<span class="muted">Sem ligação identificada</span>'}</td>
          <td>${r.ods.map((o) => seloOds(o, r.e)).join("") || '<span class="muted">—</span>'}</td></tr>`;
      }).join("")}</tbody></table>${verMais("c4", ord.length - limites.c4)}` : `<div class="empty-hint">Nenhum registro neste recorte.</div>`;

    const total = D.cinza.registros.length;
    const direta = escopo.filter((r) => r.parc.length).length;
    const relat = regs.filter((r) => r.cat === "Relatório").length;
    const tcc = regs.filter((r) => r.cat === "TCC").length;
    resposta("r4", pendente ? "parcial" : "respondida", F.cinza === "toda"
      ? `A UEA tem <b>${fmt(total)} documentos</b> fora dos periódicos nas fontes abertas. Neste recorte: ${fmt(tcc)} TCCs e só <b>${plural(relat, "relatório", "relatórios")}</b>.`
      : `<b>${fmt(escopo.length)} de ${fmt(total)}</b> documentos da UEA se ligam às parcerias do recorte, ${fmt(direta)} deles com menção direta à conveniada. O restante vem de professores que têm coautoria com elas. Só <b>${plural(relat, "é relatório", "são relatórios")}</b>.`);
  }

  /* ---------- capítulo 5 ---------- */
  function renderCap5(lista, ativos) {
    const ids = new Set(lista.map((w) => w.id));
    const citantes = D.uso.citantes.filter((c) => c.cita.some((i) => ids.has(i)));
    const titulos = new Map(D.trabalhos.map((w) => [w.id, w]));
    el("c5-citantes").innerHTML = citantes.length ? `<div class="imp-citantes">${citantes.map((c) => `
      <div class="imp-citante"><b>${tituloLink(c.t, c.url)}</b>
        <small>${c.ano || "s/d"}${c.fonte ? ` · ${esc(c.fonte)}` : ""}${c.inst.length ? ` · ${esc(c.inst.join("; "))}` : ""}</small>
        <ul>${c.cita.filter((i) => ids.has(i)).map((i) => `<li>Cita: ${tituloLink(titulos.get(i).t, titulos.get(i).doi || `https://openalex.org/${i}`)} (${titulos.get(i).ano || "s/d"}, ${depoisDoConvenio(titulos.get(i), ativos) ? "desde o convênio" : "anterior ao convênio"})</li>`).join("")}</ul>
      </div>`).join("")}</div>` : `<div class="empty-hint">Nenhum relatório indexado no OpenAlex cita os trabalhos deste recorte.</div>`;
    const posConvenio = citantes.filter((c) => c.cita.some((i) => ids.has(i) && depoisDoConvenio(titulos.get(i), ativos))).length;
    resposta("r5", "parcial", `Ainda não é possível responder por completo. <b>${plural(citantes.length, "relatório cita", "relatórios citam")}</b> trabalhos deste recorte, e <b>${fmt(posConvenio)}</b> ${posConvenio === 1 ? "cita trabalho publicado" : "citam trabalhos publicados"} desde o início do convênio. A página usa só fontes abertas, que cobrem pouco as políticas públicas e a mídia, então <b>isso não mede o impacto total</b>.`);
  }

  /* ---------- bastidores ---------- */
  function renderBastidores() {
    const f = D.cinza.fontes;
    el("b-fontes").innerHTML = `<table class="imp-tabela">
      <thead><tr><th>Fonte</th><th class="num">Recebidos</th><th class="num">Fora do escopo</th><th class="num">Aproveitados</th><th>Critério</th></tr></thead>
      <tbody>${Object.entries(f).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td class="num">${fmt(v.validados)}</td><td class="num">${fmt(v.fora)}</td><td class="num">${fmt(v.aproveitados)}</td><td>${esc(v.criterio)}</td></tr>`).join("")}</tbody></table>
      <div class="imp-nota">Depois de remover duplicatas entre fontes: <b>${fmt(D.cinza.registros.length)} documentos</b>. Oasisbr: ${fmt(D.cinza.cobertura_oasisbr.coletados)} de ${fmt(D.cinza.cobertura_oasisbr.api)} registros coletados.${(D.uso.consultadas || []).filter((c) => c.status === "ok").map((c) => ` ${esc(c.fonte)}: consultado, ${plural(c.n, "conjunto de dados", "conjuntos de dados")} da UEA no catálogo.`).join("")}</div>`;
    const c = D.metodo.calibracao;
    const faixa = c && c.faixas[String(D.metodo.min_sim_titulo)];
    el("b-metodo").innerHTML = `<div class="panel__header"><span class="panel__title">Como ler estes números</span></div><ul>
      <li><b>Coautoria:</b> trabalho no OpenAlex com autores ligados à UEA e à conveniada. Coleta de ${dataBR(D.coleta_em)}.</li>
      <li><b>Período:</b> compara a data de publicação com o início do acordo mais antigo com a instituição. Coincidência no tempo não prova que o convênio causou a coautoria.</li>
      <li><b>ODS das coautorias:</b> classificador automático do OpenAlex, com pontuação acima de ${String(D.metodo.limiar_ods_openalex).replace(".", ",")}. Um trabalho pode ter mais de um ODS.</li>
      <li><b>ODS estimado (marcado com ~):</b> ${D.metodo.ods_estimado_pendente ? "classificação em andamento." : `similaridade entre o título e a descrição do ODS (Sentence-BERT). ${faixa ? `Concordou com o OpenAlex em ${pct(faixa.concordancia, 1)}% de ${fmt(faixa.n)} trabalhos testados.` : ""} Na mesma base, sempre apostar no ODS mais comum acertaria ${c ? pct(c.acaso_ods_mais_comum, 1) : 0}%, então o ganho é moderado. Títulos que citam a Amazônia tendem a cair em Vida terrestre, mesmo quando tratam de saúde ou linguagem. Use como indicação, não como rótulo definitivo.`}</li>
      <li><b>Professores:</b> ligação por ORCID e, sem ele, por nome exato. Só ${fmt(D.n_professores_total)} nomes do painel são considerados, então a contagem é um piso.</li>
      <li><b>Citações acadêmicas</b> mostram alcance científico e não entram como impacto social.</li>
      <li><b>Fontes:</b> a página usa apenas APIs gratuitas. Bases pagas de citação em políticas públicas e mídia não são consultadas, então o uso fora da academia pode estar subestimado.</li></ul>`;
  }

  /* ---------- render ---------- */
  function render() {
    const { lista, ativos } = recorteBase();
    const comFiltroOds = F.ods ? lista.filter((w) => temOds(w, +F.ods)) : lista;
    renderCap1(comFiltroOds, ativos);
    renderCap2(comFiltroOds, ativos);
    renderCap3(lista, ativos);
    renderCinza(lista);
    renderCap5(comFiltroOds, ativos);

    const depois = comFiltroOds.filter((w) => depoisDoConvenio(w, ativos)).length;
    const nOds = new Set(comFiltroOds.flatMap((w) => w.ods.map((o) => o.n))).size;
    const idsRecorte = new Set(comFiltroOds.map((w) => w.id));
    const nCitantes = D.uso.citantes.filter((c) => c.cita.some((i) => idsRecorte.has(i))).length;
    el("topbar-stats").innerHTML = `
      <div class="topbar__stat" data-help="Trabalhos com autores da UEA e de conveniadas no recorte atual."><b>${fmt(comFiltroOds.length)}</b><small>Coautorias</small></div>
      <div class="topbar__stat" data-help="Coautorias publicadas desde o início do acordo."><b>${fmt(depois)}</b><small>Desde o convênio</small></div>
      <div class="topbar__stat" data-help="ODS distintos entre as coautorias do recorte."><b>${fmt(nOds)}</b><small>ODS relacionados</small></div>
      <div class="topbar__stat" data-help="Documentos da UEA fora dos periódicos, depois de remover duplicatas entre fontes."><b>${fmt(D.cinza.registros.length)}</b><small>Lit. cinzenta</small></div>
      <div class="topbar__stat" data-help="Relatórios indexados no OpenAlex que citam coautorias do recorte."><b>${fmt(nCitantes)}</b><small>Relatórios citantes</small></div>`;
  }

  /* ---------- interações delegadas ---------- */
  document.querySelector("main").addEventListener("click", (e) => {
    const t = e.target.closest("[data-odsbar],[data-parc],[data-prof],[data-cat],[data-mais]");
    if (!t) return;
    hideTooltip();
    if (t.dataset.mais) { limites[t.dataset.mais] += 30; render(); return; }
    if (t.dataset.odsbar) F.ods = F.ods === t.dataset.odsbar ? "" : t.dataset.odsbar;
    if (t.dataset.parc) F.parc = F.parc === t.dataset.parc ? "" : t.dataset.parc;
    if (t.dataset.prof) F.prof = F.prof === t.dataset.prof ? "" : t.dataset.prof;
    if (t.dataset.cat) F.cat = F.cat === t.dataset.cat ? "" : t.dataset.cat;
    aplicar();
  });
  document.querySelector("main").addEventListener("mousemove", (e) => {
    const t = e.target.closest("[data-tip]");
    if (t) showTooltip(e.clientX, e.clientY, t.dataset.tip); else hideTooltip();
  });
  document.querySelector("main").addEventListener("mouseleave", hideTooltip);

  el("btn-relatorio").addEventListener("click", () => {
    const { lista, ativos } = recorteBase();
    gerarRelatorioImpactos({
      D, F, lista: F.ods ? lista.filter((w) => temOds(w, +F.ods)) : lista, ativos,
      cinza: recorteCinza(lista).filter((r) =>
        (!F.ods || r.ods.some((o) => o.n === +F.ods)) && (!F.cat || r.cat === F.cat)
        && (!F.busca.trim() || norm(r.t).includes(norm(F.busca)))),
      parceiras: parceirasAtivas(), depoisDoConvenio,
    });
  });

  preencherFiltros();
  renderBastidores();
  render();
})();
