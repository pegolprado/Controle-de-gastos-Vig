"""Regras de resolução de ERB (sem banco: índices montados em memória)."""
from collections import defaultdict
from datetime import date
from types import SimpleNamespace

from app.services.erb import _cgi_from_parts, resolve_signature

V_OLD = SimpleNamespace(id=1, reference_date=date(2025, 12, 1))
V_NEW = SimpleNamespace(id=2, reference_date=date(2026, 3, 1))
VERSIONS = {1: V_OLD, 2: V_NEW}


def cell(id, **kw):
    base = dict(id=id, version_id=2, operator="TIM", tech=None, mcc="724", mnc="02", lac=None, tac=None, cell_id=None, eci=None,
                nci=None, cgi=None, site_code=None, site_name=None, sector=None, lat=-15.8, lon=-47.9)
    base.update(kw)
    return SimpleNamespace(**base)


def index(cells):
    idx = {"cell_id": defaultdict(list), "eci": defaultdict(list), "nci": defaultdict(list), "cgi": defaultdict(list), "site": defaultdict(list)}
    for c in cells:
        for k in ("cell_id", "eci", "nci"):
            if getattr(c, k):
                idx[k][getattr(c, k)].append(c)
        for k in _cgi_from_parts(c):
            idx["cgi"][k].append(c)
        for k in (c.site_code, c.site_name):
            if k:
                idx["site"][k.upper()].append(c)
    return idx


def sig(**kw):
    base = dict(operator="TIM", tech=None, mcc=None, mnc=None, lac=None, tac=None, cell_id=None, eci=None, nci=None, cgi=None, erb_raw=None)
    base.update(kw)
    return base


CELLS = [
    cell(1, tech="3G", lac="1100", cell_id="20001"),
    cell(2, tech="4G", tac="5100", eci="20001"),  # mesmo número, outra tecnologia (ECI ≠ CI)
    cell(3, tech="3G", lac="1105", cell_id="30000", lat=-15.7),
    cell(4, tech="3G", lac="1106", cell_id="30000", lat=-15.6),
    cell(5, tech="3G", lac="1100", cell_id="40000", site_code="SITE-A", operator="VIVO", mnc="11"),
    cell(6, tech="3G", lac="1100", cell_id="50000", site_code="SITE-B", sector="1"),
    cell(7, tech="3G", lac="1100", cell_id="50001", site_code="SITE-B", sector="2"),
    cell(8, tech="3G", lac="1100", cell_id="60000", version_id=1, lat=-15.80),
    cell(9, tech="3G", lac="1100", cell_id="60000", version_id=2, lat=-15.85),
]
IDX = index(CELLS)


def test_exact_full_id():
    r = resolve_signature(sig(tech="3G", mcc="724", mnc="02", lac="1100", cell_id="20001"), IDX, VERSIONS)
    assert r["status"] == "exact" and r["cell"].id == 1 and r["rule"] == "id_completo"


def test_ci_never_matches_eci():
    r = resolve_signature(sig(tech="4G", mcc="724", mnc="02", tac="5100", eci="20001"), IDX, VERSIONS)
    assert r["cell"].id == 2
    r = resolve_signature(sig(tech="3G", mcc="724", mnc="02", lac="9999", cell_id="20001"), IDX, VERSIONS)
    # sem LAC compatível não vira exata; e a célula 4G com ECI 20001 nunca é candidata
    assert r["status"] != "exact"
    assert 2 not in r["candidates"]


def test_cgi_exact():
    r = resolve_signature(sig(cgi="724-02-1100-20001"), IDX, VERSIONS)
    assert r["status"] == "exact" and r["cell"].id == 1 and r["rule"] == "cgi_exato"


def test_partial_is_probable_and_ambiguous():
    r = resolve_signature(sig(cell_id="20001"), IDX, VERSIONS)
    assert r["status"] == "probable" and r["cell"].id == 1
    r = resolve_signature(sig(cell_id="30000"), IDX, VERSIONS)
    assert r["status"] == "ambiguous" and set(r["candidates"]) == {3, 4} and r["cell"] is None


def test_operator_rules():
    # sem MCC/MNC no registro: a operadora do arquivo restringe os candidatos
    r = resolve_signature(sig(operator="TIM", cell_id="40000"), IDX, VERSIONS)
    assert r["status"] == "none" and "não resolvida" in r["note"]
    # com MCC/MNC explícitos, a rede do registro prevalece (roaming/compartilhamento) e é sinalizada
    r = resolve_signature(sig(operator="TIM", tech="3G", mcc="724", mnc="11", lac="1100", cell_id="40000"), IDX, VERSIONS)
    assert r["status"] == "exact" and r["cell"].id == 5 and "outra rede" in r["note"]
    # MNC diferente do cadastro não casa
    r = resolve_signature(sig(operator="TIM", tech="3G", mcc="724", mnc="05", lac="1100", cell_id="40000"), IDX, VERSIONS)
    assert r["status"] != "exact"


def test_site_code_sectors_are_ambiguous_unless_same_place():
    r = resolve_signature(sig(erb_raw="site-b"), IDX, VERSIONS)
    assert r["status"] == "probable" and "nível da estação" in r["note"]


def test_latest_version_wins_and_divergence_is_reported():
    r = resolve_signature(sig(tech="3G", mcc="724", mnc="02", lac="1100", cell_id="60000"), IDX, VERSIONS)
    assert r["status"] == "exact" and r["cell"].id == 9
    assert "divergentes entre versões" in r["note"]


def test_no_identifier_or_unknown():
    r = resolve_signature(sig(cell_id="99999"), IDX, VERSIONS)
    assert r["status"] == "none" and r["cell"] is None and "99999" in r["note"]
