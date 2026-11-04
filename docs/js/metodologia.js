/* ==========================================================================
   Metodologia detalhada por análise — botão (i) em cada painel [data-method]
   --------------------------------------------------------------------------
   Cada painel com data-method="<chave>" ganha um botão (i) no cabeçalho.
   O clique abre uma janela com:
     1. O que mostra   (texto do data-help do próprio painel)
     2. Metodologia    (blocos reutilizáveis abaixo, em prosa de artigo)
     3. Parâmetros     (valores exatos usados no código)
     4. Reprodução     (scripts e comandos)
   e um botão "Copiar texto" para colar no manuscrito.

   ATENÇÃO: os parâmetros aqui espelham as constantes do ETL. Se mudar alguma
   constante em etl/linha_match.py, MATCHING/rerank.py, etl/ods_classify.py
   ou etl/ods_openalex.py, atualize este arquivo também.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------- blocos de metodologia (reutilizáveis) ---------------- */
  const B = {
    fontesUEA: {
      titulo: "Base da UEA (PPGs, linhas e docentes)",
      texto: [
        "Os Programas de Pós-Graduação (PPG) da Universidade do Estado do Amazonas (UEA), suas linhas de pesquisa oficiais (título e descrição) e o corpo docente de cada programa foram obtidos de uma planilha institucional mantida pela PROPESP/ARI (Google Sheets, exportada em CSV pelo endpoint gviz). A aba de linhas fornece título e descrição de cada linha; a aba “PPGxDocente” fornece o vínculo docente–PPG, o ORCID e o ID Lattes preenchidos pela própria instituição.",
        "Não foram usados currículos Lattes nem dados derivados deles. Cada par (docente, PPG) é um registro; só são descartadas linhas duplicadas idênticas da planilha. A base atual tem 29 PPGs, 166 linhas de pesquisa e 323 vínculos docente–PPG (137 com ORCID, 153 com ID Lattes).",
      ],
      params: [
        ["Fonte", "Planilha PROPESP/ARI (Google Sheets → CSV)"],
        ["Scripts", "DATA BASE UEA/PPGS_LINHAS/etl/build_ppgs_linhas.py, build_docentes.py"],
        ["Unidade de análise", "Linha de pesquisa oficial (título + descrição)"],
      ],
    },

    conveniadas: {
      titulo: "Instituições conveniadas (alvos)",
      texto: [
        "O conjunto de alvos é o universo dos acordos vigentes da UEA registrados no painel de Gestão de Convênios (42 acordos, incluindo as instituições brasileiras). Cada instituição foi mapeada manualmente para o seu identificador de instituição no OpenAlex (Institution ID), com consulta a api.openalex.org/institutions?search= e conferência de nome, país e ROR.",
        "Subunidades sem identificador próprio foram atribuídas à instituição-mãe (por exemplo, Faculdade de Medicina da UBA → Universidad de Buenos Aires; NOVA FCSH → Universidade NOVA de Lisboa; FUA → UFAM). Seis acordos não têm perfil acadêmico no OpenAlex (ISCED Sumbe, VanWest College, Instituto Tecnológico do Putumayo, Geocuba, Universidade Licungo e Embaixada da República Dominicana). Eles continuam listados, mas com zero matches, e ficam fora do matching. Restam 36 instituições elegíveis.",
      ],
      params: [
        ["Universo", "42 acordos (painel de Gestão de Convênios, campo “acordos”)"],
        ["Elegíveis (com OpenAlex ID)", "36"],
        ["Mapeamento curado", "etl/convenios_openalex.json"],
        ["Script", "etl/convenios.py"],
      ],
    },

    matching: {
      titulo: "Matching linha de pesquisa × pesquisador da conveniada",
      texto: [
        "(1) Consultas. Para cada linha de pesquisa, o título e até cinco frases derivadas da descrição formam as consultas. A descrição é segmentada em “;” e “.”, e entram os segmentos de 3 a 12 palavras. Título, frases e o texto completo (título + descrição) foram traduzidos de português para inglês offline com Argos Translate. Frases que, após a tradução, coincidem com termos genéricos de uma lista de exclusão (ex.: “biology”, “education”, “health”, “analysis”, 41 termos) foram descartadas.",
        "(2) Aquisição de candidatos. Cada frase em inglês foi submetida ao endpoint /works do OpenAlex (busca textual “search”), filtrado pela instituição conveniada (institutions.id) e por publicações a partir de 1º de janeiro do ano corrente menos cinco (janela de 5 anos; 2021-01-01 na execução de 2026), com os 8 primeiros resultados por consulta. São candidatos os autores desses trabalhos cuja afiliação, naquele trabalho, é a instituição conveniada. Os candidatos foram deduplicados pelo identificador de autor do OpenAlex dentro de cada par (linha, instituição), com limite de 60 por par. Cada candidato é representado pelo título do trabalho em que foi encontrado (“sample_title”).",
        "(3) Reordenação semântica. Os textos da linha (frases em inglês + título e descrição traduzidos) e o título do trabalho do candidato foram padronizados: tokenização, remoção de stopwords e pontuação, lematização com spaCy (en_core_web_sm) e minúsculas. Em seguida, foram codificados com o modelo Sentence-BERT all-MiniLM-L6-v2 (embeddings normalizados). O escore do par é a maior similaridade de cosseno entre qualquer texto da linha e o título do candidato. Todos os candidatos (até 60) são mantidos, ordenados pelo escore.",
        "(4) Registro. Cada match é a tripla (linha de pesquisa, pesquisador da conveniada, instituição) com o escore e o trabalho de amostra (título e DOI). Um match de linha vale para todos os docentes do PPG dono da linha. Não há corte mínimo de escore no matching: o valor 0,30 é só uma referência visual, e 0,50 define “match forte” nas análises de ODS. As respostas do OpenAlex ficam em cache por (frase, instituição, ano inicial), o que torna a execução reprodutível e incremental.",
      ],
      params: [
        ["Janela de publicações", "from_publication_date = (ano corrente − 5)-01-01 → 2021-01-01"],
        ["Consultas por linha", "título + até 5 frases da descrição (3–12 palavras)"],
        ["Resultados por consulta", "8 (per-page)"],
        ["Candidatos por (linha, instituição)", "até 60, deduplicados por OpenAlex author ID"],
        ["Tradução PT→EN", "Argos Translate 1.11.0 (offline)"],
        ["Padronização", "spaCy 3.8 + en_core_web_sm 3.8.0 (lemas, sem stopwords)"],
        ["Modelo de embeddings", "sentence-transformers/all-MiniLM-L6-v2 (sentence-transformers 6.0.0, PyTorch 2.13)"],
        ["Escore", "max cos(texto da linha, título do trabalho do candidato) ∈ [−1, 1], na prática 0–1"],
        ["Corte de escore", "nenhum no matching; 0,30 referência visual; 0,50 “forte” (ODS)"],
        ["Fonte bibliográfica", "OpenAlex /works (api.openalex.org)"],
        ["Scripts", "etl/linha_match.py → MATCHING/rerank.py → PADRONIZAÇAO/padronizar.py"],
      ],
    },

    sbert: {
      titulo: "Similaridade semântica (Sentence-BERT)",
      texto: [
        "A similaridade é o cosseno entre os vetores (embeddings) que o modelo all-MiniLM-L6-v2 gera para o texto da linha de pesquisa (traduzido para o inglês e lematizado) e para o título de uma publicação do pesquisador da conveniada. Com embeddings normalizados, o cosseno equivale ao produto escalar. Valores próximos de 1 indicam significado muito parecido; próximos de 0, ausência de relação semântica.",
        "No Sankey, o valor mostrado para uma faixa (linha × instituição) é a média aritmética dos escores de todos os matches daquele par.",
      ],
      params: [
        ["Modelo", "all-MiniLM-L6-v2 (384 dimensões)"],
        ["Agregação por faixa", "média dos escores dos matches do par linha × instituição"],
        ["Linha de referência no medidor", "0,30"],
      ],
    },

    contagem: {
      titulo: "Contagem de conexões",
      texto: [
        "Uma “conexão” é um registro de match (linha de pesquisa × pesquisador da conveniada). As contagens consideram os filtros ativos do painel (PPG, linha, país, instituição, docente e atributos CAPES) e são calculadas no navegador a partir de data/dashboard.json. O mesmo pesquisador pode contar mais de uma vez se casou com várias linhas.",
      ],
      params: [["Base", "data/dashboard.json → linha_matches"]],
    },

    capes: {
      titulo: "Conceito CAPES",
      texto: [
        "O conceito, o nível (Mestrado/Doutorado), a modalidade e a situação de cada PPG vêm da Avaliação Quadrienal CAPES 2021–2024, compilados na planilha “Conceitos PPGs – UEA”. Cursos adicionais do mesmo programa (ex.: Doutorado) herdam o conceito do PPG. A sigla do programa é o elo com a base de linhas e docentes, com ajustes manuais documentados no script.",
      ],
      params: [
        ["Fonte", "DATA BASE UEA/NOTAS PPG/Conceitos PPGs - UEA.xlsx"],
        ["Script", "etl/export_capes_notas.py → data/capes_notas.json"],
      ],
    },

    geo: {
      titulo: "Georreferenciamento",
      texto: [
        "As coordenadas de cada conveniada vêm do painel de Gestão de Convênios, onde foram curadas. Na ausência delas, o nome da instituição no OpenAlex e o país são geocodificados com o Nominatim (OpenStreetMap), respeitando o limite de 1 requisição/s e com cache local. Algumas instituições têm coordenadas manuais aproximadas ao nível da cidade-sede. A origem dos fluxos é Manaus/AM (−3,1316; −59,9825). O mapa de calor por país usa a malha de países Natural Earth (TopoJSON).",
      ],
      params: [
        ["Coordenadas", "painel de convênios (instituicoes_geo) → Nominatim (reserva)"],
        ["Scripts", "etl/export_dashboard_data.py, etl/geocode.py"],
      ],
    },

    odsClass: {
      titulo: "Classificação das linhas da UEA nos 17 ODS",
      texto: [
        "Cada linha de pesquisa foi classificada nos Objetivos de Desenvolvimento Sustentável (ODS) da ONU por similaridade semântica, sem rotulagem manual. O texto da linha (título + descrição truncada em 500 caracteres, sem o trecho padronizado “Área de Concentração…”, que se repete em todas as linhas do PPG) foi traduzido para o inglês com Argos Translate. Cada ODS foi representado por uma descrição temática curta em inglês, redigida a partir das metas oficiais. Linha e ODS foram codificados com all-MiniLM-L6-v2 e comparados pelo cosseno.",
        "Cada linha recebe até 3 ODS: os que têm similaridade ≥ 0,20 e ficam a no máximo 0,06 do melhor ODS da linha. Se nenhum passa do limiar, fica só o melhor, marcado como classificação fraca. O peso de cada ODS na linha é a similaridade normalizada entre os ODS mantidos (soma 1).",
      ],
      params: [
        ["Modelo", "all-MiniLM-L6-v2 (cosseno linha × descrição do ODS)"],
        ["Limiar absoluto", "0,20"],
        ["Margem em relação ao melhor ODS", "0,06"],
        ["Máx. de ODS por linha", "3"],
        ["Peso", "sim / Σ sim dos ODS mantidos"],
        ["Script", "etl/ods_classify.py → data/ods.json"],
      ],
    },

    odsContatos: {
      titulo: "Contatos por ODS",
      texto: [
        "Para cada instituição conveniada e cada ODS, conta-se o número de pesquisadores distintos (por OpenAlex author ID) com pelo menos um match forte (escore ≥ 0,50) com uma linha da UEA classificada naquele ODS. A medida indica se há pessoas concretas para contatar no tema. Ela não mede a força da universidade no tema.",
      ],
      params: [
        ["Match forte", "escore SBERT ≥ 0,50"],
        ["Unidade", "pesquisadores distintos (OpenAlex author ID)"],
      ],
    },

    odsOpenAlex: {
      titulo: "Força da universidade por ODS (OpenAlex)",
      texto: [
        "A produção de cada conveniada por ODS foi medida independentemente do matching. Usou-se o classificador de ODS do próprio OpenAlex: /works filtrado por institutions.id, publicações desde o início da mesma janela de 5 anos e sustainable_development_goals.score > 0,4, agrupado por sustainable_development_goals.id. O denominador é o total de trabalhos da instituição na mesma janela, sem filtro de ODS.",
        "Participação (%) = trabalhos no ODS / total de trabalhos (multirrótulo: um trabalho pode contar em mais de um ODS). Índice de especialização = participação da instituição no ODS / média das participações das conveniadas do mesmo país no painel (1 = na média; > 1 = especializada). A pontuação temática é Σ_ODS (peso do ODS nas linhas da UEA × índice de especialização), onde o peso do ODS na UEA é a soma dos pesos das linhas naquele ODS dividida pelo número de linhas. Instituições com menos de 500 trabalhos na janela são sinalizadas como amostra instável.",
      ],
      params: [
        ["Limiar de score ODS (OpenAlex)", "> 0,4"],
        ["Janela", "mesma do matching (desde 2021-01-01)"],
        ["Referência do índice", "média das conveniadas do mesmo país"],
        ["Amostra mínima estável", "500 trabalhos"],
        ["Script", "etl/ods_openalex.py → data/ods_openalex.json (≈3 chamadas por instituição)"],
      ],
    },

    afinidade: {
      titulo: "Grau de afinidade semântica (OpenAlex, em tempo real)",
      texto: [
        "A barra é calculada no navegador, no momento da visita. O título da publicação mais recente da pessoa do perfil (via ORCID no OpenAlex) é enviado à busca semântica do OpenAlex (search.semantic, até 2.000 caracteres), filtrada pelo ORCID de cada pessoa listada (filter=author.orcid). O relevance_score do melhor resultado é a afinidade.",
        "É calculada só para as 8 primeiras pessoas com ORCID, em sequência, com intervalo de 1,1 s para respeitar o limite da API. A barra é relativa ao maior valor encontrado entre elas. É uma aproximação exploratória e não faz parte do matching. Como depende da API em tempo real, o valor pode variar entre visitas.",
      ],
      params: [
        ["Endpoint", "api.openalex.org/works?search.semantic=…&filter=author.orcid:…&per-page=1"],
        ["Itens calculados", "8 primeiros com ORCID"],
        ["Escala", "relativa ao maior relevance_score do conjunto"],
        ["Código", "docs/js/common.js (relevanciaSemanticaOpenAlex)"],
      ],
    },

    publicacoes: {
      titulo: "Publicações",
      texto: [
        "As publicações são consultadas em tempo real no OpenAlex pelo ORCID da pessoa (filter=author.orcid), ordenadas por data de publicação decrescente, até 25 trabalhos. Sem ORCID, o perfil do pesquisador da conveniada mostra os trabalhos de amostra que geraram os matches (título e DOI registrados no matching).",
      ],
      params: [
        ["Endpoint", "api.openalex.org/works?filter=author.orcid:…&sort=publication_date:desc&per-page=25"],
      ],
    },

    instOpenAlex: {
      titulo: "Dados da instituição",
      texto: [
        "Os dados do acordo (tipo, vigência) vêm do painel de Gestão de Convênios. Tipo, site, número de publicações, citações e registro ROR são consultados em tempo real em api.openalex.org/institutions/<ID>, usando o identificador OpenAlex curado (busca exata, sem ambiguidade de nome).",
      ],
      params: [["Endpoint", "api.openalex.org/institutions/<OpenAlex ID>"]],
    },
  };

  const REPRODUCAO = [
    "cd \"DASHBOARD/DASHBOARD Matchs de convenios\"",
    "python3 etl/linha_match.py --fontes <ids> --merge   # matching (cache OpenAlex; para no HTTP 429)",
    "python3 etl/export_dashboard_data.py                # data/dashboard.json",
    "python3 etl/ods_openalex.py                         # data/ods_openalex.json",
    "../../MATCHING/.venv/bin/python etl/ods_classify.py # data/ods.json",
  ].join("\n");

  /* ---------------- análises (painéis) → blocos ---------------- */
  const M = {
    "ppg":            { blocos: ["fontesUEA", "capes"], extra: "A seleção de um PPG restringe linhas, docentes e conexões às do programa. Um match de linha vale para todos os docentes do PPG." },
    "capes-filtros":  { blocos: ["capes"], extra: "Os filtros atuam sobre os PPGs e, por consequência, sobre linhas, docentes e conexões exibidos." },
    "linhas":         { blocos: ["fontesUEA", "matching", "contagem"], extra: "O número ao lado de cada linha é a quantidade de matches dela com pesquisadores das conveniadas, sob os filtros ativos." },
    "docentes":       { blocos: ["fontesUEA"], extra: "A lista vem da aba PPGxDocente. O ícone ORCID aparece quando a planilha tem o identificador preenchido." },
    "sankey":         { blocos: ["matching", "sbert", "contagem"], extra: "Diagrama de Sankey (d3-sankey): a espessura da faixa é o número de matches do par linha × instituição. Para legibilidade, aparecem as 22 linhas e as 24 instituições com mais matches; as demais são agrupadas em “Outras” com peso visual fixo. O valor real aparece no tooltip." },
    "sbert":          { blocos: ["sbert", "matching"] },
    "pais-filtro":    { blocos: ["conveniadas", "contagem"], extra: "O país é o país da instituição conveniada, conforme registrado no painel de Gestão de Convênios." },
    "mapa":           { blocos: ["geo", "contagem"], extra: "Coroplético: a intensidade da cor de cada país é proporcional ao número de matches com conveniadas sediadas nele, sob os filtros ativos." },
    "ods-mini":       { blocos: ["odsClass", "odsContatos"], extra: "O número em cada ODS é a quantidade de pesquisadores distintos das conveniadas com conexão a linhas classificadas naquele ODS, sob os filtros ativos." },
    "ranking":        { blocos: ["matching", "contagem"], extra: "Os pesquisadores são agregados por ORCID (ou pelo nome, sem ORCID) e ordenados pelo número de matches. Aparecem os 12 primeiros." },
    "flow-legenda":   { blocos: ["contagem"], extra: "A espessura do arco e o raio do ponto seguem uma escala de raiz quadrada do número de matches da conveniada (arco de 1,4 a 6 px; ponto de 3 a 11 px)." },
    "flow-globo":     { blocos: ["conveniadas", "geo", "contagem"], extra: "Globo ortográfico (d3-geo). Cada arco liga Manaus a uma conveniada com pelo menos um match. Espessura e cor seguem uma escala de raiz quadrada do número de matches." },
    "ods-grid":       { blocos: ["odsClass"], extra: "O número em cada ODS é a quantidade de linhas da UEA que receberam aquele ODS (entre até 3 por linha)." },
    "ods-matriz":     { blocos: ["odsContatos", "odsOpenAlex", "odsClass"], extra: "A matriz instituição × ODS alterna três métricas: contatos (pesquisadores com match forte), participação % e índice de especialização (OpenAlex)." },
    "prof-perfil":    { blocos: ["matching"], extra: "Nome, ORCID e OpenAlex ID vêm do registro de autoria do OpenAlex no trabalho que gerou o match." },
    "prof-contato":   { blocos: ["publicacoes"], extra: "Links públicos (ORCID, OpenAlex) disponíveis para o pesquisador." },
    "prof-linhas":    { blocos: ["matching"], extra: "São as linhas de pesquisa oficiais da UEA que casaram com este pesquisador, ordenadas pelo número de matches (até 30)." },
    "prof-docentes":  { blocos: ["fontesUEA", "afinidade"], extra: "Os docentes listados são os vinculados aos PPGs donos das linhas que geraram o match. O número ao lado é calculado pela afinidade semântica." },
    "prof-inst":      { blocos: ["conveniadas", "instOpenAlex"] },
    "prof-mapa":      { blocos: ["geo"] },
    "prof-inst-oa":   { blocos: ["instOpenAlex"] },
    "prof-pubs":      { blocos: ["publicacoes", "matching"] },
    "doc-perfil":     { blocos: ["fontesUEA"] },
    "doc-contato":    { blocos: ["fontesUEA"], extra: "ORCID e ID Lattes vêm da planilha institucional, e o link OpenAlex usa o filtro author.orcid." },
    "doc-linhas":     { blocos: ["fontesUEA"] },
    "doc-pesq":       { blocos: ["matching", "afinidade"], extra: "Os pesquisadores são agregados por ORCID (ou nome) a partir dos matches das linhas do(s) PPG(s) do docente e ordenados pelo número de conexões." },
    "doc-ppg":        { blocos: ["capes"] },
    "doc-mapa":       { blocos: ["geo"] },
    "doc-pubs":       { blocos: ["publicacoes"] },
  };

  /* ---------------- render ---------------- */
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function montar(chave, ajuda, titulo) {
    const def = M[chave];
    if (!def) return null;
    const blocos = def.blocos.map((k) => B[k]).filter(Boolean);
    const params = [];
    const vistos = new Set();
    for (const b of blocos) for (const p of b.params || []) {
      const k = p[0] + "|" + p[1];
      if (!vistos.has(k)) { vistos.add(k); params.push(p); }
    }

    let html = "";
    let txt = (titulo ? titulo.toUpperCase() + "\n\n" : "");
    if (ajuda) {
      html += `<section><h3>O que mostra</h3><p>${esc(ajuda)}</p></section>`;
      txt += "O que mostra\n" + ajuda + "\n\n";
    }
    html += `<section><h3>Metodologia</h3>`;
    txt += "Metodologia\n";
    if (def.extra) { html += `<p class="met-extra">${esc(def.extra)}</p>`; txt += def.extra + "\n\n"; }
    for (const b of blocos) {
      html += `<h4>${esc(b.titulo)}</h4>` + b.texto.map((t) => `<p>${esc(t)}</p>`).join("");
      txt += b.titulo + "\n" + b.texto.join("\n") + "\n\n";
    }
    html += `</section>`;
    if (params.length) {
      html += `<section><h3>Parâmetros</h3><table class="met-params"><tbody>${
        params.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")
      }</tbody></table></section>`;
      txt += "Parâmetros\n" + params.map(([k, v]) => `- ${k}: ${v}`).join("\n") + "\n\n";
    }
    html += `<section><h3>Reprodução</h3><pre class="met-code">${esc(REPRODUCAO)}</pre>
      <p class="met-note">Execução de referência: novembro de 2026. Os resultados das APIs (OpenAlex, Nominatim) ficam em cache em disco. Com os mesmos caches e as mesmas versões de modelo, a execução é determinística.</p></section>`;
    txt += "Reprodução\n" + REPRODUCAO + "\n";
    return { html, txt };
  }

  let modal, modalBody, modalTitle, textoAtual = "";

  function garantirModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "met-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "met-modal-title");
    modal.innerHTML = `
      <div class="met-modal__backdrop" data-close></div>
      <div class="met-modal__card">
        <header class="met-modal__head">
          <h2 id="met-modal-title"></h2>
          <div class="met-modal__actions">
            <button type="button" class="met-btn" id="met-copy">Copiar texto</button>
            <button type="button" class="met-btn met-btn--icon" data-close aria-label="Fechar">✕</button>
          </div>
        </header>
        <div class="met-modal__body"></div>
      </div>`;
    document.body.appendChild(modal);
    modalBody = modal.querySelector(".met-modal__body");
    modalTitle = modal.querySelector("#met-modal-title");
    modal.addEventListener("click", (ev) => { if (ev.target.closest("[data-close]")) fechar(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && modal.classList.contains("is-open")) fechar(); });
    modal.querySelector("#met-copy").addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      try {
        await navigator.clipboard.writeText(textoAtual);
        btn.textContent = "Copiado ✓";
      } catch {
        btn.textContent = "Não foi possível copiar";
      }
      setTimeout(() => { btn.textContent = "Copiar texto"; }, 1800);
    });
  }

  function abrir(painel) {
    garantirModal();
    const chave = painel.getAttribute("data-method");
    const tituloEl = painel.querySelector(".panel__title");
    const titulo = (tituloEl && tituloEl.textContent.trim()) || painel.getAttribute("data-method-title") || "Metodologia";
    const r = montar(chave, painel.getAttribute("data-help"), titulo);
    if (!r) return;
    modalTitle.textContent = titulo;
    modalBody.innerHTML = r.html;
    modalBody.scrollTop = 0;
    textoAtual = r.txt;
    modal.classList.add("is-open");
    document.body.classList.add("met-lock");
    if (typeof hideHelpTooltip === "function") hideHelpTooltip();
    modal.querySelector(".met-btn--icon").focus();
  }

  function fechar() {
    modal.classList.remove("is-open");
    document.body.classList.remove("met-lock");
  }

  function instalar() {
    document.querySelectorAll("[data-method]").forEach((painel) => {
      if (painel.querySelector(":scope > .met-info, :scope > .panel__header > .met-info")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "met-info";
      btn.setAttribute("aria-label", "Metodologia desta análise");
      btn.title = "Metodologia desta análise";
      btn.textContent = "i";
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); abrir(painel); });
      const header = painel.querySelector(":scope > .panel__header");
      if (header) {
        header.appendChild(btn);
      } else {
        btn.classList.add("met-info--float");
        if (getComputedStyle(painel).position === "static") painel.style.position = "relative";
        painel.appendChild(btn);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", instalar);
  else instalar();
})();
