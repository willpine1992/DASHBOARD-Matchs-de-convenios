# FIND A ACADEMIC PARTNER - FAAP · CONVÊNIOS · Matchs com as universidades conveniadas da UEA

Dashboard interativo que cruza os **Programas de Pós-Graduação (PPG)** da
**Universidade do Estado do Amazonas (UEA)** — e suas linhas de pesquisa
**oficiais** (nome + descrição, mantidas pela PROPESP/ARI) — com pesquisadores
das **instituições que já têm acordo vigente com a UEA**.

É uma cópia do painel de prospecção
([DASHBOARD PROSPECÇAO PPGxUNI.ESTR](https://github.com/willpine1992/DASHBOARD-PROSPECC-AO-PPGxUNI.ESTR))
com **exatamente a mesma metodologia** (linha de pesquisa × publicações OpenAlex,
rerank semântico Sentence-BERT). Só muda a lista de alvos: em vez de países/
universidades escolhidos para prospecção, os alvos são **todos os acordos do
painel de convênios** (`DASHBOARD/DASHBOARD CONVENIOS UEA`), inclusive as
instituições brasileiras, tratadas igual às estrangeiras.

**🔗 Repositórios (push duplo pelo mesmo `origin`):**
- https://github.com/willpine1992/DASHBOARD-Matchs-de-convenios
- https://github.com/internacionalizacao-create/DASHBOARD-Matchs-de-convenios

## O que tem no dashboard

| Página | Conteúdo |
|---|---|
| **Painel** (`docs/index.html`) | Filtro em cascata **PPG → Linha de pesquisa**, Sankey linha de pesquisa × instituição conveniada, mapa dos países das conveniadas, ranking de pesquisadores das conveniadas e quadro de ODS. O indicador "Conveniadas com match (de N)" compara com o total de acordos do painel de convênios |
| **Mapa de Fluxo** (`docs/flowmap.html`) | Globo 3D com arcos de Manaus até cada conveniada com match |
| **ODS** (`docs/ods.html`) | Os 17 ODS × linhas de pesquisa da UEA × conveniadas. Reflete só os matches das conveniadas; o bloco OpenAlex (participação % e índice de especialização por universidade) está preenchido para as conveniadas (`etl/ods_openalex.py`) |
| **Perfil do pesquisador** (`docs/professor.html`) | Pesquisador da conveniada: linhas em comum, docentes UEA conectados, instituição (com **tipo e vigência do convênio**, mini-mapa e dados OpenAlex buscados pelo ID exato) e publicações (ORCID) |
| **Perfil do docente UEA** (`docs/docente.html`) | PPG(s), linhas oficiais, pesquisadores das conveniadas conectados, links ORCID/OpenAlex/Lattes |

Site **estático** (HTML/CSS/JS + JSON), publicado via GitHub Pages.

## De onde vêm as conveniadas

```
DASHBOARD CONVENIOS UEA/data/dashboard.json   (campo "acordos" — fonte única dos convênios)
        │
        ▼
etl/convenios.py  +  etl/convenios_openalex.json (mapeamento curado instituição -> ID OpenAlex)
        │
        ├──> etl/linha_match.py         FONTES = um alvo por acordo (id = id do acordo, ex. AC0001)
        ├──> etl/export_dashboard_data.py  coordenadas e dados do acordo; lista "convenios" completa
        └──> etl/ods_openalex.py        métricas ODS por conveniada
```

- `convenios_openalex.json` tem `status: ok` (entra no matching) ou
  `sem_openalex` (sem perfil acadêmico no OpenAlex: ISCED Sumbe, VanWest
  College, Inst. Tecnológico do Putumayo, Geocuba, Univ. Licungo, Embaixada da
  Rep. Dominicana). Essas aparecem só na lista `convenios` do JSON, com
  `n_matches = 0`.
- Subunidades sem ID próprio no OpenAlex usam a instituição-mãe (UBA –
  Faculdade de Medicina → UBA; NOVA FCSH → Universidade NOVA de Lisboa). O NHGRI
  tem ID próprio e é usado direto. FUA → UFAM.
- **Convênio novo no painel de convênios** sem entrada no mapeamento faz o ETL
  falhar listando o que falta — adicione a entrada (buscando o ID em
  `https://api.openalex.org/institutions?search=...`) e rode de novo.
- Nos matches, `foreign_institution` é o **nome do convênio** (igual ao painel
  de convênios), e `foreign_institution_openalex` guarda o nome do OpenAlex;
  `convenio_id` liga cada match ao acordo.

## Como atualizar os dados

```bash
cd "DASHBOARD/DASHBOARD Matchs de convenios"
python3 etl/linha_match.py                       # todos os convênios (usa o cache; só busca o que falta)
python3 etl/linha_match.py --fontes AC0042 --merge  # só um convênio novo, preservando os demais
python3 etl/export_dashboard_data.py             # data/dashboard.json
python3 etl/ods_openalex.py                      # data/ods_openalex.json (≈3 chamadas por conveniada)
../../MATCHING/.venv/bin/python etl/ods_classify.py   # data/ods.json
```

Cache de aquisição OpenAlex: convênios que já eram alvos da prospecção
reaproveitam o cache de lá (`WEBSCRAPING/<país>/...`); os demais ficam em
`WEBSCRAPING/CONVENIOS UEA/cache/<ID OpenAlex>_match_cache.json`. Um 429
(cota OpenAlex) interrompe sem gravar resultado vazio no cache — é só rodar de
novo com `--merge`.

Depois: `git commit` e `git push` (o `origin` empurra para os dois repositórios).

## Como rodar localmente

```bash
python3 -m http.server 8000   # na raiz deste repositório
```

Abra `http://localhost:8000/docs/index.html`.

## Limitações conhecidas

- 6 dos 41 acordos não têm perfil no OpenAlex e, portanto, não têm match.
- Guiana Francesa não tem polígono próprio no mapa-múndi (é parte da França no
  TopoJSON), então não é colorida no mapa de países; aparece normalmente no
  globo de fluxo e nos filtros.
- Match é por linha de pesquisa do PPG: todo docente de um PPG vê os mesmos
  pesquisadores conectados.
- ORCID/ID Lattes dos docentes dependem do preenchimento da planilha PPGxDocente.

Base canônica de PPGs/linhas e docentes: `DATA BASE UEA/PPGS_LINHAS/`.
`README-DESIGN.txt` documenta o design system (o mesmo do painel de prospecção).
