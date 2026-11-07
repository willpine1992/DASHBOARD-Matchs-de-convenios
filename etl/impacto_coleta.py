"""
Coleta da página de monitoramento de impactos (docs/impacto.html).

Junta, num único arquivo bruto (cache/impacto_coleta.json, fora do git):

  OpenAlex  - coautorias UEA × cada conveniada (com ODS, autores da UEA, DOI);
              total da UEA por tipo e por ODS (linha de base);
              produção não periódica da UEA (report, dataset, dissertation...);
              relatórios que citam as coautorias (sinal aberto de uso).
  Oasisbr   - produção depositada no repositório da UEA (institution:UEA).
  Zenodo    - registros com afiliação à UEA (conferida registro a registro).
  OpenAIRE  - produtos ligados à organização UEA (a busca textual é imprecisa
              e por isso não é usada).
  Crossref  - relatórios cuja afiliação traz literalmente o nome da UEA
              (query.affiliation é aproximada: traz UERJ, UFSM etc.).

  dados.gov.br - conjuntos de dados que citam a UEA no catálogo.

Só entram APIs gratuitas ou com cota gratuita. Bases pagas não são consultadas.

Chaves: lidas de POSDOC - MAC/TOKENS/chaves.env (ver README.md dessa pasta).

Uso:
    python3 etl/impacto_coleta.py            # tudo
    python3 etl/impacto_coleta.py --so-oasisbr
    MATCHING/.venv/bin/python etl/impacto_export.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TOKENS_ENV = REPO_ROOT.parents[3] / "TOKENS" / "chaves.env"  # fora de qualquer repositório


def ler_chave(nome: str) -> str:
    """Lê a chave de POSDOC - MAC/TOKENS/chaves.env; nenhuma chave fica no código."""
    valor = os.environ.get(nome)
    if valor:
        return valor
    if TOKENS_ENV.exists():
        for linha in TOKENS_ENV.read_text(encoding="utf-8").splitlines():
            if linha.startswith(f"{nome}="):
                return linha.split("=", 1)[1].strip()
    sys.exit(f"ERRO: chave {nome} não encontrada em {TOKENS_ENV}")


API_KEY = ler_chave("OPENALEX_API_KEY")
DASHBOARD_JSON = REPO_ROOT / "data" / "dashboard.json"
SAIDA = REPO_ROOT / "cache" / "impacto_coleta.json"

UEA_ID = "I4210147594"
OPENAIRE_ORG = "pending_org_::17b0b29a5ad7d9a889e18abea9aa7284"
USER_AGENT = "UEA-APF-Dashboard/1.0"
LIMIAR_ODS = 0.4  # o mesmo de etl/ods_openalex.py
TIPOS_CINZA = "report|dataset|dissertation|preprint|software|other"
UEA_NOMES = ("universidade do estado do amazonas", "amazonas state university", "state university of amazonas")
CAMPOS_WORK = (
    "id,doi,title,publication_date,publication_year,type,cited_by_count,"
    "primary_location,sustainable_development_goals,authorships"
)


def colaboracao_gigante(w: dict) -> bool:
    """O OpenAlex corta a lista de autores em 100 nas consultas em lote. Lista
    cortada SEM autor da UEA visível é colaboração gigante (ex.: CMS/LHC), em
    que não dá para atribuir o trabalho a um professor. Ensaios clínicos com mais
    de 100 autores em que a UEA aparece continuam na base."""
    aut = w.get("authorships") or []
    return len(aut) >= 100 and not any(
        (i.get("id") or "").endswith(UEA_ID) for a in aut for i in a.get("institutions", []))


class FonteFalhou(RuntimeError):
    pass


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def get_json(url: str, tentativas: int = 4, pausa: float = 0.0) -> dict:
    erro = None
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                dados = json.loads(r.read().decode("utf-8"))
            if pausa:
                time.sleep(pausa)
            return dados
        except urllib.error.HTTPError as e:
            erro = f"HTTP {e.code}"
            if e.code not in (429, 500, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            erro = str(e)
        time.sleep(5 * (t + 1))
    raise FonteFalhou(f"{erro} em {url.replace(API_KEY, 'KEY')}")


def openalex(path: str, **params) -> dict:
    params["api_key"] = API_KEY
    return get_json(f"https://api.openalex.org/{path}?" + urllib.parse.urlencode(params, safe=":,|>"), pausa=0.12)


def openalex_todos(filtro: str, select: str) -> list[dict]:
    out, cursor = [], "*"
    while cursor:
        d = openalex("works", filter=filtro, select=select, cursor=cursor, per_page=200)
        out += d["results"]
        cursor = d["meta"].get("next_cursor")
        if not d["results"]:
            break
    return out


def parceiras() -> tuple[list[dict], list[dict]]:
    """Uma entrada por instituição (uma instituição pode ter mais de um acordo)."""
    painel = json.loads(DASHBOARD_JSON.read_text(encoding="utf-8"))
    por_id: dict[str, dict] = {}
    sem_id = []
    for c in painel["convenios"]:
        oid = c.get("openalex_id")
        if not oid:
            sem_id.append({"instituicao": c["instituicao"], "pais": c["pais"], "nota": c.get("nota")})
            continue
        p = por_id.setdefault(oid, {
            "openalex_id": oid, "instituicao": c["instituicao"], "openalex_nome": c.get("openalex_nome"),
            "pais": c["pais"], "convenios": [], "data_inicio": None, "status": set(),
        })
        p["convenios"].append(c.get("convenio_id"))
        if c.get("status"):
            p["status"].add(c["status"])
        if c.get("data_inicio") and (not p["data_inicio"] or c["data_inicio"] < p["data_inicio"]):
            p["data_inicio"] = c["data_inicio"]
    lista = sorted(por_id.values(), key=lambda p: p["instituicao"])
    for p in lista:
        p["status"] = sorted(p["status"])
    return lista, sem_id


def coletar_coautorias(lista: list[dict]) -> dict:
    trabalhos: dict[str, dict] = {}
    for i, p in enumerate(lista, 1):
        rs = openalex_todos(f"institutions.id:{UEA_ID},institutions.id:{p['openalex_id']}", CAMPOS_WORK)
        p["n_openalex"] = len(rs)
        print(f"  [{i}/{len(lista)}] {p['instituicao']}: {len(rs)}", file=sys.stderr)
        for w in rs:
            alvo = trabalhos.setdefault(w["id"], {**w, "parceiras": []})
            alvo["parceiras"].append(p["openalex_id"])
    return trabalhos


def coletar_linha_base() -> dict:
    base = f"institutions.id:{UEA_ID}"
    tipos = openalex("works", filter=base, group_by="type")
    ods = openalex("works", filter=f"{base},sustainable_development_goals.score:>{LIMIAR_ODS}",
                   group_by="sustainable_development_goals.id")
    return {
        "total": tipos["meta"]["count"],
        "por_tipo": {g["key"].rsplit("/", 1)[-1]: g["count"] for g in tipos["group_by"]},
        "com_ods": ods["meta"]["count"],
        "ods": {str(g["key"]).rsplit("/", 1)[-1]: g["count"] for g in ods["group_by"]},
    }


def coletar_citantes(ids: list[str]) -> list[dict]:
    """Relatórios indexados no OpenAlex que citam as coautorias."""
    achados: dict[str, dict] = {}
    alvo = {i.rsplit("/", 1)[-1] for i in ids}
    curtos = sorted(alvo)
    for ini in range(0, len(curtos), 50):
        lote = "|".join(curtos[ini:ini + 50])
        rs = openalex_todos(f"cites:{lote},type:report",
                            "id,doi,title,publication_year,type,primary_location,authorships,referenced_works")
        for w in rs:
            achados[w["id"]] = {
                "id": w["id"], "doi": w.get("doi"), "titulo": w.get("title"), "ano": w.get("publication_year"),
                "fonte": ((w.get("primary_location") or {}).get("source") or {}).get("display_name"),
                "instituicoes": sorted({
                    (inst.get("display_name"), inst.get("type"))
                    for a in w.get("authorships", []) for inst in a.get("institutions", [])
                    if inst.get("display_name")
                }),
                "cita": sorted(r.rsplit("/", 1)[-1] for r in (w.get("referenced_works") or [])
                               if r.rsplit("/", 1)[-1] in alvo),
            }
    return list(achados.values())


def coletar_oasisbr() -> dict:
    """A API repete registros ao paginar além de ~1.000 resultados: a coleta é
    particionada por ano (e por formato, se o ano passar disso) e deduplicada.
    A cobertura contra o total da API fica registrada no JSON."""
    base = "https://oasisbr.ibict.br/vufind/api/v1/search"
    campos = ["title", "formats", "publishDate", "institutions", "urls", "id", "authors"]
    filtro_uea = 'institution:"UEA"'

    def consulta(filtros: list[str], pagina: int, limite: int = 100) -> dict:
        q = [("lookfor", "*"), ("type", "AllFields"), ("limit", str(limite)), ("page", str(pagina))]
        q += [("filter[]", f) for f in filtros] + [("field[]", c) for c in campos]
        return get_json(base + "?" + urllib.parse.urlencode(q), pausa=0.3)

    def varrer(filtros: list[str], unicos: dict) -> None:
        pagina = 1
        while True:
            rs = consulta(filtros, pagina).get("records", [])
            for r in rs:
                unicos[r["id"]] = r
            if len(rs) < 100:
                return
            pagina += 1

    total = consulta([filtro_uea], 1, 0).get("resultCount", 0)
    unicos: dict[str, dict] = {}
    for ano in range(1950, date.today().year + 2):
        filtros = [filtro_uea, f'publishDate:"{ano}"']
        n = consulta(filtros, 1, 0).get("resultCount", 0)
        if not n:
            continue
        if n < 900:
            varrer(filtros, unicos)
        else:
            for fmt in ("bachelorThesis", "masterThesis", "doctoralThesis", "article", "book", "bookPart",
                        "conferenceObject", "report", "other"):
                varrer(filtros + [f'format:"{fmt}"'], unicos)
        print(f"  oasisbr {ano}: {n} (únicos até agora {len(unicos)}/{total})", file=sys.stderr)
    registros = list(unicos.values())
    # a sigla "UEA" não é exclusiva: fica só o que aponta para o repositório da UEA
    filtrados = [r for r in registros if any("ri.uea.edu.br" in (u.get("url") or "") for u in r.get("urls", []))]
    return {"total_api": total, "coletados": len(registros), "registros": filtrados}


def coletar_zenodo() -> dict:
    registros, pagina, total = [], 1, None
    q = urllib.parse.quote('creators.affiliation:"Universidade do Estado do Amazonas" '
                           'OR creators.affiliation:"Amazonas State University"')
    while True:
        d = get_json(f"https://zenodo.org/api/records?q={q}&size=25&page={pagina}", pausa=2.2)
        total = d["hits"]["total"]
        hits = d["hits"]["hits"]
        if not hits:
            break
        registros += hits
        print(f"  zenodo {len(registros)}/{total}", file=sys.stderr)
        if len(registros) >= total:
            break
        pagina += 1
    ok = [h for h in registros if any(
        n in norm(c.get("affiliation")) for c in h["metadata"].get("creators", []) for n in UEA_NOMES)]
    return {"total_api": total, "coletados": len(registros), "registros": ok}


def coletar_openaire() -> dict:
    registros, pagina, total = [], 1, None
    while True:
        d = get_json("https://api.openaire.eu/graph/v1/researchProducts?"
                     + urllib.parse.urlencode({"relOrganizationId": OPENAIRE_ORG, "pageSize": 100, "page": pagina}),
                     pausa=0.5)
        total = d["header"]["numFound"]
        rs = d.get("results") or []
        if not rs:
            break
        registros += rs
        if len(registros) >= total:
            break
        pagina += 1
    return {"total_api": total, "coletados": len(registros), "registros": registros}


def coletar_crossref() -> dict:
    registros, cursor, total = [], "*", None
    while True:
        q = {"query.affiliation": '"Universidade do Estado do Amazonas"', "filter": "type:report",
             "rows": 200, "cursor": cursor, "select": "DOI,title,type,author,published,URL"}
        m = get_json("https://api.crossref.org/works?" + urllib.parse.urlencode(q), pausa=0.5)["message"]
        total = m["total-results"]
        if not m["items"]:
            break
        registros += m["items"]
        cursor = m["next-cursor"]
        if len(registros) >= total:
            break
    ok = [r for r in registros if any(
        n in norm(a.get("name")) for au in r.get("author", []) for a in au.get("affiliation", []) for n in UEA_NOMES)]
    return {"total_api": total, "coletados": len(registros), "registros": ok}


def coletar_dados_gov() -> dict:
    """Catálogo federal, por nome do conjunto. Só fica o que cita a UEA no título."""
    token = ler_chave("DADOS_GOV_BR_TOKEN")
    achados: dict[str, dict] = {}
    termos = ("Universidade do Estado do Amazonas", "UEA")
    for termo in termos:
        q = urllib.parse.urlencode({"isPrivado": "false", "pagina": 1, "nomeConjuntoDados": termo})
        req = urllib.request.Request(
            f"https://dados.gov.br/dados/api/publico/conjuntos-dados?{q}",
            headers={"chave-api-dados-abertos": token, "User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                dados = json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            raise FonteFalhou(f"dados.gov.br: {e}") from e
        for d in dados:
            if UEA_NOMES[0] in norm(d.get("title")) or re.search(r"\\bUEA\\b", d.get("title") or ""):
                achados[d["id"]] = {"id": d["id"], "titulo": d.get("title"), "nome": d.get("nome")}
    return {"termos": list(termos), "registros": list(achados.values())}


def tentar(nome: str, fn, *args) -> dict:
    """Falha de uma fonte vira status explícito no JSON, nunca um zero silencioso."""
    print(f"{nome}...", file=sys.stderr)
    try:
        return {"status": "ok", **fn(*args)}
    except (FonteFalhou, KeyError, TypeError) as e:
        print(f"  FALHOU {nome}: {e}", file=sys.stderr)
        return {"status": "erro", "erro": str(e), "registros": []}


def main() -> None:
    if "--so-oasisbr" in sys.argv:
        resultado = json.loads(SAIDA.read_text(encoding="utf-8"))
        resultado["oasisbr"] = tentar("oasisbr", coletar_oasisbr)
        SAIDA.write_text(json.dumps(resultado, ensure_ascii=False), encoding="utf-8")
        r = resultado["oasisbr"]
        print(f"oasisbr: status={r['status']} api={r.get('total_api')} coletados={r.get('coletados')} "
              f"validados={len(r['registros'])}", file=sys.stderr)
        return
    if "--so-dados-gov" in sys.argv:
        resultado = json.loads(SAIDA.read_text(encoding="utf-8"))
        resultado["dados_gov"] = tentar("dados_gov", coletar_dados_gov)
        SAIDA.write_text(json.dumps(resultado, ensure_ascii=False), encoding="utf-8")
        print(f"dados_gov: status={resultado['dados_gov']['status']} registros={len(resultado['dados_gov']['registros'])}", file=sys.stderr)
        return
    lista, sem_id = parceiras()
    print(f"{len(lista)} instituições com ID; {len(sem_id)} acordos sem ID OpenAlex", file=sys.stderr)
    trabalhos = coletar_coautorias(lista)
    print("linha de base da UEA...", file=sys.stderr)
    base = coletar_linha_base()
    print("produção não periódica da UEA...", file=sys.stderr)
    cinza_oa = openalex_todos(f"institutions.id:{UEA_ID},type:{TIPOS_CINZA}", CAMPOS_WORK)

    nacionais = {p["openalex_id"] for p in lista if p["pais"] == "Brasil"}
    estrangeiras = [w["id"] for w in trabalhos.values()
                    if not colaboracao_gigante(w) and set(w["parceiras"]) - nacionais]
    print(f"relatórios que citam {len(estrangeiras)} coautorias estrangeiras...", file=sys.stderr)
    citantes = coletar_citantes(estrangeiras)

    resultado = {
        "gerado_em": date.today().isoformat(),
        "parceiras": lista, "sem_openalex": sem_id,
        "trabalhos": list(trabalhos.values()),
        "linha_base": base,
        "cinza_openalex": cinza_oa,
        "citantes": citantes,
        "oasisbr": tentar("oasisbr", coletar_oasisbr),
        "zenodo": tentar("zenodo", coletar_zenodo),
        "openaire": tentar("openaire", coletar_openaire),
        "crossref": tentar("crossref", coletar_crossref),
        "dados_gov": tentar("dados_gov", coletar_dados_gov),
    }
    SAIDA.parent.mkdir(exist_ok=True)
    SAIDA.write_text(json.dumps(resultado, ensure_ascii=False), encoding="utf-8")
    print(f"gravado {SAIDA} ({SAIDA.stat().st_size // 1024} KB)", file=sys.stderr)
    for f in ("oasisbr", "zenodo", "openaire", "crossref"):
        r = resultado[f]
        print(f"{f}: status={r['status']} api={r.get('total_api')} coletados={r.get('coletados')} "
              f"validados={len(r['registros'])}", file=sys.stderr)
    print(f"coautorias únicas={len(trabalhos)} citantes={len(citantes)} cinza_oa={len(cinza_oa)}", file=sys.stderr)


if __name__ == "__main__":
    main()
