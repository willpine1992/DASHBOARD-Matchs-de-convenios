"""Lista de universidades conveniadas da UEA, lida direto do painel de convênios
(DASHBOARD CONVENIOS UEA/data/dashboard.json, campo `acordos`) e cruzada com o
mapeamento curado etl/convenios_openalex.json (instituição -> ID OpenAlex).

É a única fonte das instituições-alvo deste painel: linha_match.py monta as
FONTES a partir daqui e export_dashboard_data.py usa os metadados do acordo
(tipo, vigência, coordenadas). Um convênio novo no painel de convênios que
ainda não esteja no mapeamento faz carregar_convenios() falhar com a lista do
que falta mapear — nunca é ignorado em silêncio.
"""
from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DASHBOARDS_ROOT = REPO_ROOT.parents[1]  # .../PROJETOS DASHBOARDS

CONVENIOS_JSON = DASHBOARDS_ROOT / "DASHBOARD" / "DASHBOARD CONVENIOS UEA" / "data" / "dashboard.json"
MAPEAMENTO_JSON = Path(__file__).resolve().parent / "convenios_openalex.json"
CACHE_PADRAO_DIR = DASHBOARDS_ROOT / "WEBSCRAPING" / "CONVENIOS UEA" / "cache"


def carregar_convenios() -> list[dict]:
    """Um item por acordo: metadados do acordo + coordenadas do painel de
    convênios + mapeamento OpenAlex (status, openalex_id, cache)."""
    painel = json.loads(CONVENIOS_JSON.read_text(encoding="utf-8"))
    mapeamento = json.loads(MAPEAMENTO_JSON.read_text(encoding="utf-8"))["instituicoes"]
    geo = {g["instituicao"]: g for g in painel.get("instituicoes_geo", [])}

    faltando = [a["instituicao"] for a in painel["acordos"] if a["instituicao"] not in mapeamento]
    if faltando:
        raise RuntimeError(
            "Convênios sem mapeamento OpenAlex em etl/convenios_openalex.json: "
            + "; ".join(faltando)
        )

    convenios = []
    for a in painel["acordos"]:
        m = mapeamento[a["instituicao"]]
        g = geo.get(a["instituicao"], {})
        if m["status"] == "ok":
            cache = (
                DASHBOARDS_ROOT / m["cache"] if m.get("cache")
                else CACHE_PADRAO_DIR / f"{m['openalex_id']}_match_cache.json"
            )
        else:
            cache = None
        convenios.append({
            "convenio_id": a["id"],
            "instituicao": a["instituicao"],
            "pais": a["pais"],
            "continente": a.get("continente"),
            "tipo": a.get("tipo"),
            "status": a.get("status"),
            "ativo": a.get("ativo"),
            "data_inicio": (a.get("data_inicio") or "")[:10] or None,
            "data_fim": (a.get("data_fim") or "")[:10] or None,
            "prazo_indeterminado": a.get("prazo_indeterminado"),
            "lat": g.get("lat"),
            "lon": g.get("lon"),
            "openalex_status": m["status"],
            "openalex_id": m.get("openalex_id"),
            "openalex_nome": m.get("openalex_nome"),
            "nota": m.get("nota"),
            "cache": cache,
        })
    return convenios


def fontes_de_match() -> list[dict]:
    """FONTES no formato de linha_match.py — só convênios com perfil no OpenAlex."""
    return [
        {
            "id": c["convenio_id"],
            "pais": c["pais"],
            "instituicao": c["instituicao"],
            "country_code": None,
            "institution_id": c["openalex_id"],
            "cache": c["cache"],
        }
        for c in carregar_convenios()
        if c["openalex_status"] == "ok"
    ]
