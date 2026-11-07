"""
Monta data/impacto.json (base de docs/impacto.html) a partir de
cache/impacto_coleta.json (gerado por etl/impacto_coleta.py).

  - liga autores da UEA aos professores do painel (ORCID, depois nome exato);
  - separa o que é literatura cinzenta do que é artigo comum depositado em
    repositório, e deduplica entre fontes (DOI, depois título normalizado);
  - nos registros sem ODS (Oasisbr, Zenodo, Crossref), estima o ODS pelo título
    com o mesmo Sentence-BERT de etl/ods_classify.py. O ODS estimado fica marcado
    (`e: 1`) e a qualidade, medida contra os rótulos do OpenAlex, vai no JSON.

Nenhum nome de estudante vai para o JSON: de autores, só guardamos o id dos
professores já públicos no painel.

Uso (precisa do venv do MATCHING):
    MATCHING/.venv/bin/python etl/impacto_export.py
    MATCHING/.venv/bin/python etl/impacto_export.py --calibrar   # só mede o classificador
    python3 etl/impacto_export.py --sem-sbert                    # prévia, sem ODS estimado
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

REPO_ROOT = Path(__file__).resolve().parent.parent
DASHBOARDS_ROOT = REPO_ROOT.parents[1]
sys.path.insert(0, str(DASHBOARDS_ROOT / "PADRONIZAÇAO"))
sys.path.insert(0, str(DASHBOARDS_ROOT / "MATCHING"))

COLETA = REPO_ROOT / "cache" / "impacto_coleta.json"
CACHE_ODS = REPO_ROOT / "cache" / "impacto_ods_titulos.json"
CACHE_TRAD = REPO_ROOT / "cache" / "impacto_traducoes.json"
DASHBOARD_JSON = REPO_ROOT / "data" / "dashboard.json"
ODS_JSON = REPO_ROOT / "data" / "ods.json"
SAIDA = REPO_ROOT / "data" / "impacto.json"

UEA_ID = "I4210147594"
LIMIAR_ODS_OPENALEX = 0.4
MIN_SIM_TITULO = 0.30   # calibrado com --calibrar; abaixo disso o título fica "sem ODS"
UEA_NOMES = ("universidade do estado do amazonas", "amazonas state university", "state university of amazonas")

# Zenodo: fora da literatura cinzenta (artigos e recortes automáticos de artigos)
ZENODO_FORA = {"article", "taxonomictreatment", "figure", "plot", "photo", "drawing", "diagram"}
RE_RECORTE = re.compile(r"^\s*(fig(ure|\.)?\s*\w*\d|figures?\b|tab(le|\.)\s*\d|table\s+s?\d|additional file|"
                        r"supplement|supporting information|data from:)", re.I)

CATEGORIA = {
    "bachelorThesis": "TCC", "masterThesis": "Dissertação", "dissertation": "Dissertação",
    "doctoralThesis": "Tese", "thesis": "Tese",
    "book": "Livro e capítulo", "bookPart": "Livro e capítulo", "section": "Livro e capítulo",
    "report": "Relatório", "technicalnote": "Relatório", "workingpaper": "Relatório",
    "dataset": "Dados e software", "software": "Dados e software",
    "preprint": "Preprint",
    "conferenceObject": "Evento", "conferencepaper": "Evento", "poster": "Evento", "presentation": "Evento",
}


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def nome_direto(s: str) -> str:
    """'Luz, Jefferson da' -> 'jefferson da luz'."""
    if "," in s:
        fim, ini = s.split(",", 1)
        s = f"{ini} {fim}"
    return norm(s)


def colaboracao_gigante(w: dict) -> bool:
    aut = w.get("authorships") or []
    return len(aut) >= 100 and not any(
        (i.get("id") or "").endswith(UEA_ID) for a in aut for i in a.get("institutions", []))


def ods_openalex(w: dict) -> list[dict]:
    out = []
    for s in w.get("sustainable_development_goals") or []:
        n = str(s.get("id", "")).rsplit("/", 1)[-1]
        if n.isdigit() and (s.get("score") or 0) > LIMIAR_ODS_OPENALEX:
            out.append({"n": int(n), "s": round(s["score"], 2)})
    return sorted(out, key=lambda o: -o["s"])


def fonte_de(w: dict) -> str | None:
    return ((w.get("primary_location") or {}).get("source") or {}).get("display_name")


class Professores:
    def __init__(self, lista: list[dict]):
        self.por_orcid = {p["orcid"]: p["id"] for p in lista if p.get("orcid")}
        self.por_nome = {nome_direto(p["nome"]): p["id"] for p in lista}

    def de_autorias(self, autorias: list[dict]) -> tuple[set, int]:
        achados, outros = set(), 0
        for a in autorias:
            if not any((i.get("id") or "").endswith(UEA_ID) for i in a.get("institutions", [])):
                continue
            au = a.get("author") or {}
            orcid = (au.get("orcid") or "").replace("https://orcid.org/", "")
            pid = self.por_orcid.get(orcid) or self.por_nome.get(norm(au.get("display_name")))
            if pid:
                achados.add(pid)
            else:
                outros += 1
        return achados, outros

    def de_nomes(self, nomes) -> set:
        return {self.por_nome[n] for n in map(nome_direto, nomes) if n in self.por_nome}


def casar_parceiras(afiliacoes: list[str], parceiras: list[dict]) -> list[str]:
    textos = [norm(a) for a in afiliacoes if a]
    achadas = []
    for p in parceiras:
        nomes = [norm(p["instituicao"]), norm(p.get("openalex_nome"))]
        if any(n and n in t for n in nomes for t in textos):
            achadas.append(p["openalex_id"])
    return achadas


def montar_cinza(R: dict, profs: Professores) -> tuple[list[dict], dict]:
    registros: list[dict] = []
    resumo = {}
    parceiras = R["parceiras"]
    ids_parc = {p["openalex_id"] for p in parceiras}

    # OpenAlex (já traz ODS)
    fora = 0
    for w in R["cinza_openalex"]:
        titulo = w.get("title") or ""
        if RE_RECORTE.match(titulo):
            fora += 1
            continue
        pids, _ = profs.de_autorias(w.get("authorships") or [])
        inst = {(i.get("id") or "").rsplit("/", 1)[-1] for a in w.get("authorships") or [] for i in a.get("institutions", [])}
        registros.append({
            "fonte": "OpenAlex", "t": titulo, "ano": w.get("publication_year"),
            "cat": CATEGORIA.get(w.get("type"), "Outros"),
            "url": w.get("doi") or w["id"], "doi": w.get("doi"), "ods": ods_openalex(w), "e": 0,
            "prof": sorted(pids), "parc": sorted(inst & ids_parc),
        })
    resumo["OpenAlex"] = {"validados": len(R["cinza_openalex"]), "fora": fora, "criterio": "tipos não periódicos, sem recortes de artigo"}

    # Crossref (relatórios com afiliação literal à UEA)
    for r in R["crossref"]["registros"]:
        ano = ((r.get("published") or {}).get("date-parts") or [[None]])[0][0]
        nomes = [f"{a.get('given', '')} {a.get('family', '')}" for a in r.get("author", [])]
        afil = [x.get("name") for a in r.get("author", []) for x in a.get("affiliation", [])]
        registros.append({
            "fonte": "Crossref", "t": re.sub(r"<[^>]+>", "", (r.get("title") or [""])[0]), "ano": ano, "cat": "Relatório",
            "url": r.get("URL"), "doi": f"https://doi.org/{r['DOI']}", "ods": [], "e": 1,
            "prof": sorted(profs.de_nomes(nomes)), "parc": casar_parceiras(afil, parceiras),
        })
    resumo["Crossref"] = {"validados": R["crossref"]["coletados"], "fora": R["crossref"]["coletados"] - len(R["crossref"]["registros"]),
                          "criterio": "tipo report com afiliação literal à UEA"}

    # Zenodo
    fora = 0
    for h in R["zenodo"]["registros"]:
        m = h["metadata"]
        rt = m.get("resource_type") or {}
        sub, tipo = rt.get("subtype"), rt.get("type")
        if sub in ZENODO_FORA or tipo == "image" or RE_RECORTE.match(m.get("title") or ""):
            fora += 1
            continue
        criadores = m.get("creators", [])
        registros.append({
            "fonte": "Zenodo", "t": m.get("title") or "", "ano": int((m.get("publication_date") or "0")[:4]) or None,
            "cat": CATEGORIA.get(sub) or CATEGORIA.get(tipo) or "Outros",
            "url": (h.get("links") or {}).get("self_html"), "doi": f"https://doi.org/{h['doi']}" if h.get("doi") else None,
            "ods": [], "e": 1, "prof": sorted(profs.de_nomes(c.get("name") or "" for c in criadores)),
            "parc": casar_parceiras([c.get("affiliation") for c in criadores], parceiras),
        })
    resumo["Zenodo"] = {"validados": len(R["zenodo"]["registros"]), "fora": fora, "criterio": "afiliação conferida; sem artigos, figuras e tratamentos taxonômicos"}

    # Oasisbr (repositório da UEA)
    fora = 0
    for r in R["oasisbr"]["registros"]:
        formatos = r.get("formats") or []
        if "article" in formatos:
            fora += 1
            continue
        a = r.get("authors") or {}
        nomes = list(a.get("primary") or []) + list(a.get("secondary") or [])
        data = r.get("publishDate")
        data = data[0] if isinstance(data, list) and data else data
        ano = int(str(data)[:4]) if str(data or "")[:4].isdigit() else None
        url = next((u["url"] for u in r.get("urls", []) if "ri.uea.edu.br" in (u.get("url") or "")), None)
        registros.append({
            "fonte": "Oasisbr", "t": r.get("title") or "", "ano": ano,
            "cat": next((CATEGORIA[f] for f in formatos if f in CATEGORIA), "Outros"),
            "url": url, "doi": None, "ods": [], "e": 1, "prof": sorted(profs.de_nomes(nomes)), "parc": [],
        })
    resumo["Oasisbr"] = {"validados": len(R["oasisbr"]["registros"]), "fora": fora, "criterio": "repositório da UEA; sem artigos de periódico"}

    # OpenAIRE (só o que não é artigo)
    fora = 0
    for r in R["openaire"]["registros"]:
        tipos = [i.get("type") for i in r.get("instances") or []]
        if "Article" in tipos:
            fora += 1
            continue
        doi = next((p["value"] for p in r.get("pids") or [] if p.get("scheme") == "doi"), None)
        registros.append({
            "fonte": "OpenAIRE", "t": r.get("mainTitle") or "", "ano": int((r.get("publicationDate") or "0")[:4]) or None,
            "cat": "Livro e capítulo" if any("book" in (t or "").lower() for t in tipos) else "Outros",
            "url": f"https://doi.org/{doi}" if doi else None, "doi": f"https://doi.org/{doi}" if doi else None,
            "ods": [], "e": 1, "prof": sorted(profs.de_nomes(a.get("fullName") or "" for a in r.get("authors") or [])),
            "parc": casar_parceiras([o.get("legalName") for o in r.get("organizations") or []], parceiras),
        })
    resumo["OpenAIRE"] = {"validados": len(R["openaire"]["registros"]), "fora": fora, "criterio": "ligado à organização UEA; sem artigos"}

    # deduplicação: a ordem acima é a prioridade (OpenAlex traz ODS; Oasisbr traz o tipo local)
    vistos: dict[str, dict] = {}
    unicos = []
    for r in registros:
        chaves = [k for k in ((r["doi"] or "").lower(), norm(r["t"])) if k]
        existente = next((vistos[k] for k in chaves if k in vistos), None)
        if existente:
            if r["fonte"] not in existente["fontes"]:
                existente["fontes"].append(r["fonte"])
            existente["prof"] = sorted(set(existente["prof"]) | set(r["prof"]))
            existente["parc"] = sorted(set(existente["parc"]) | set(r["parc"]))
            continue
        novo = {**r, "fontes": [r["fonte"]]}
        del novo["fonte"]
        unicos.append(novo)
        for k in chaves:
            vistos[k] = novo
    for f, d in resumo.items():
        d["aproveitados"] = sum(1 for r in registros if r["fonte"] == f)
        d["exclusivos"] = sum(1 for u in unicos if u["fontes"] == [f])
    return unicos, resumo


PT = set("de da do das dos em para com uma um uso sobre entre ao aos pela pelo nas nos que na no estudo analise ensino".split())
EN = set("the of and in for with on from to a an by study analysis among using".split())


def parece_portugues(t: str) -> bool:
    tok = norm(t).split()
    return sum(x in PT for x in tok) > sum(x in EN for x in tok)


def traduzir_titulos(titulos: list[str]) -> dict[str, str]:
    """Só traduz o que parece português (o tradutor deforma título já em inglês).
    Salva o progresso: a tradução offline é lenta e pode ser retomada."""
    from padronizar import traduzir
    feitos = json.loads(CACHE_TRAD.read_text(encoding="utf-8")) if CACHE_TRAD.exists() else {}
    faltam = [t for t in dict.fromkeys(titulos) if t not in feitos and parece_portugues(t)]
    print(f"traduzindo {len(faltam)} de {len(set(titulos))} títulos...", file=sys.stderr)
    for i, t in enumerate(faltam, 1):
        feitos[t] = traduzir(t[:300], "pt", "en")
        if i % 100 == 0:
            CACHE_TRAD.write_text(json.dumps(feitos, ensure_ascii=False), encoding="utf-8")
            print(f"  {i}/{len(faltam)}", file=sys.stderr, flush=True)
    CACHE_TRAD.write_text(json.dumps(feitos, ensure_ascii=False), encoding="utf-8")
    return feitos


def sims_titulos(titulos: list[str]):
    from ods_classify import ODS
    from matcher import carregar_modelo, embed_termos
    from sentence_transformers import util

    cache = json.loads(CACHE_ODS.read_text(encoding="utf-8")) if CACHE_ODS.exists() else {}
    faltam = [t for t in dict.fromkeys(titulos) if t not in cache]
    if faltam:
        trad = traduzir_titulos(faltam)
        modelo = carregar_modelo()
        emb_t = embed_termos([trad.get(t, t) for t in faltam], modelo)
        emb_o = embed_termos([o[4] for o in ODS], modelo)
        sims = util.cos_sim(emb_t, emb_o).cpu().numpy()
        for t, linha in zip(faltam, sims):
            cache[t] = [round(float(x), 3) for x in linha]
        CACHE_ODS.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    return [cache[t] for t in titulos]


def calibrar(R: dict) -> dict:
    """Mede o classificador contra o OpenAlex, nos trabalhos que têm os dois."""
    amostra = [w for w in R["trabalhos"] if not colaboracao_gigante(w) and ods_openalex(w) and w.get("title")]
    sims = sims_titulos([w["title"] for w in amostra])
    faixas = {}
    for lim in (0.20, 0.25, 0.30, 0.35, 0.40):
        cob = acerto = 0
        for w, s in zip(amostra, sims):
            melhor = max(range(17), key=lambda j: s[j])
            if s[melhor] >= lim:
                cob += 1
                if melhor + 1 in {o["n"] for o in ods_openalex(w)}:
                    acerto += 1
        faixas[str(lim)] = {"cobertura": round(cob / len(amostra), 3), "concordancia": round(acerto / cob, 3) if cob else None, "n": cob}
    base = Counter(o["n"] for w in amostra for o in ods_openalex(w)[:1]).most_common(1)[0]
    return {"amostra": len(amostra), "faixas": faixas, "acaso_ods_mais_comum": round(base[1] / len(amostra), 3), "ods_mais_comum": base[0]}


def main() -> None:
    R = json.loads(COLETA.read_text(encoding="utf-8"))
    sem_sbert = "--sem-sbert" in sys.argv  # prévia rápida: sem ODS estimado na literatura cinzenta
    calib = None if sem_sbert else calibrar(R)
    print(json.dumps(calib, ensure_ascii=False, indent=1), file=sys.stderr)
    if "--calibrar" in sys.argv:
        return

    painel = json.loads(DASHBOARD_JSON.read_text(encoding="utf-8"))
    ods_meta = json.loads(ODS_JSON.read_text(encoding="utf-8"))["ods"]
    profs = Professores(painel["professores"])

    trabalhos, usados = [], set()
    for w in sorted(R["trabalhos"], key=lambda x: x.get("publication_date") or "", reverse=True):
        pids, outros = profs.de_autorias(w.get("authorships") or [])
        usados |= pids
        trabalhos.append({
            "id": w["id"].rsplit("/", 1)[-1], "doi": w.get("doi"), "t": w.get("title") or "(sem título)",
            "ano": w.get("publication_year"), "data": w.get("publication_date"), "tipo": w.get("type"),
            "cit": w.get("cited_by_count") or 0, "fonte": fonte_de(w), "ods": ods_openalex(w),
            "parc": w["parceiras"], "prof": sorted(pids), "outros": outros,
            "gig": colaboracao_gigante(w),
        })

    cinza, resumo = montar_cinza(R, profs)
    sem_ods = [r for r in cinza if r["e"]]
    for r, s in zip(sem_ods, [] if sem_sbert else sims_titulos([r["t"] for r in sem_ods])):
        melhor = max(range(17), key=lambda j: s[j])
        r["ods"] = [{"n": melhor + 1, "s": s[melhor]}] if s[melhor] >= MIN_SIM_TITULO else []
    for r in cinza:
        usados |= set(r["prof"])

    validos = {t["id"] for t in trabalhos if not t["gig"]}
    citantes = []
    for c in R["citantes"]:
        cita = [i for i in c["cita"] if i in validos]
        if not cita or norm(c["titulo"]) == "item unavailable":
            continue
        citantes.append({
            "t": c["titulo"], "ano": c["ano"], "fonte": c["fonte"], "url": c["doi"] or c["id"],
            "inst": [i[0] for i in c["instituicoes"]][:6], "cita": cita,
        })

    resultado = {
        "gerado_em": date.today().isoformat(),
        "coleta_em": R["gerado_em"],
        "metodo": {"limiar_ods_openalex": LIMIAR_ODS_OPENALEX, "min_sim_titulo": MIN_SIM_TITULO, "calibracao": calib,
                   "ods_estimado_pendente": sem_sbert},
        "ods": ods_meta,
        "linha_base": R["linha_base"],
        "parceiras": [{
            "id": p["openalex_id"], "nome": p["instituicao"], "pais": p["pais"], "ini": p["data_inicio"],
            "status": p["status"], "convenios": p["convenios"], "nacional": p["pais"] == "Brasil",
        } for p in R["parceiras"]],
        "sem_openalex": R["sem_openalex"],
        "professores": [{"id": p["id"], "nome": p["nome"], "programas": p.get("programas", [])}
                        for p in painel["professores"] if p["id"] in usados],
        "n_professores_total": len(painel["professores"]),
        "trabalhos": trabalhos,
        "cinza": {
            "fontes": resumo,
            "cobertura_oasisbr": {"api": R["oasisbr"].get("total_api"), "coletados": R["oasisbr"].get("coletados")},
            "registros": cinza,
        },
        "uso": {
            "citantes": citantes,
            "consultadas": [{
                "fonte": "dados.gov.br", "mede": "conjuntos de dados no catálogo federal",
                "status": R.get("dados_gov", {}).get("status", "nao_coletado"),
                "n": len(R.get("dados_gov", {}).get("registros", [])),
            }],
        },
    }
    SAIDA.write_text(json.dumps(resultado, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"gravado {SAIDA} ({SAIDA.stat().st_size // 1024} KB)", file=sys.stderr)
    print(json.dumps(resumo, ensure_ascii=False, indent=1), file=sys.stderr)
    print("cinza únicos", len(cinza), Counter(r["cat"] for r in cinza).most_common(), file=sys.stderr)
    print("cinza com ODS", sum(1 for r in cinza if r["ods"]), "citantes", len(citantes), file=sys.stderr)
    print("cinza com professor", sum(1 for r in cinza if r["prof"]), "com parceira", sum(1 for r in cinza if r["parc"]), file=sys.stderr)


if __name__ == "__main__":
    main()
