"""Fluxo de aceitação completo (seção 22) executado pela API com dados sintéticos."""
import hashlib
import io

from conftest import drain_jobs, user_id

T1, T2 = "(61) 90000-1001", "(61) 90000-1002"
N1, N2 = "+5561900001001", "+5561900001002"
C1, C2, C3 = "(61) 98000-0001", "(61) 98000-0002", "(61) 98000-0003"


def cdr_csv_target1() -> bytes:
    lines = [
        "EXTRATO SINTÉTICO DE TESTE - TIM",
        "",
        "Número A;Número B;Data;Hora;Duração;Tipo;MCC;MNC;LAC;CI",
        f"{T1};{C1};01/03/2026;10:00:00;00:01:00;Originada;724;02;1100;20001",
        f"{C1};{T1};01/03/2026;10:30:00;00:02:00;Recebida;724;02;1100;20001",
        f"{T1};{C2};02/03/2026;23:10:00;00:00:30;Originada;724;02;1100;20002",
        f"{T1};{T2};02/03/2026;12:00:00;00:03:00;Originada;724;02;1100;20001",
        f"{T1};{C3};03/03/2026;09:00:00;00:00:00;SMS Originado;724;02;1100;29999",
        f"{T1};{C1};03/03/2026;09:05:00;00:00:40;Originada;724;02;1100;20001",
        f"{T1};{C1};03/03/2026;09:05:00;00:00:40;Originada;724;02;1100;20001",  # duplicado
        f"{T1};{C2};28/02/2026;08:00:00;00:00:10;Originada;724;02;1100;20001",  # fora do período
        f"{T1};{C2};31/02/2026;08:00:00;00:00:10;Originada;724;02;1100;20001",  # data inválida
    ]
    return "\r\n".join(lines).encode("cp1252")


def cdr_csv_target2() -> bytes:
    lines = [
        "Data/Hora;Linha;Interlocutor;Sentido;Serviço;Duração (s);CGI",
        f"2026-03-02T12:00:01-03:00;{N2[3:]};{N1[3:]};Entrante;Voz;180;724-02-1100-20001",
        f"2026-03-02T15:00:00-03:00;{N2[3:]};{C1[1:3]}{C1[5:].replace('-', '')};Sainte;Voz;60;724-02-1100-20002",
        f"2026-03-03T09:06:00-03:00;{N2[3:]};{C2[1:3]}{C2[5:].replace('-', '')};Sainte;SMS;0;724-02-1100-20001",
    ]
    return "\n".join(lines).encode("utf-8")


def erb_csv() -> bytes:
    lines = [
        "Operadora,Tecnologia,MCC,MNC,LAC,CI,Nome ERB,Latitude,Longitude,Azimute",
        'TIM,3G,724,02,1100,20001,ERB Teste 1,"-15,79","-47,88",120',
        'TIM,3G,724,02,1100,20002,ERB Teste 2,"-15,80","-47,89",240',
    ]
    return "\n".join(lines).encode("utf-8")


def upload(client, case_id, name, data, kind="cdr", operator=None):
    r = client.post(f"/api/cases/{case_id}/files", files={"files": (name, io.BytesIO(data))}, data={"kind": kind, **({"operator": operator} if operator else {})})
    assert r.status_code == 200, r.text
    return r.json()[0]


def configure_and_run(client, case_id, f, kind, extra_opts):
    a = client.post(f"/api/cases/{case_id}/files/{f['id']}/analyze", json={"kind": kind, "read": {}})
    assert a.status_code == 200, a.text
    an = a.json()
    opts = {"read": {}, **extra_opts}
    for fld in ("date", "time", "datetime"):
        if fld in an["formats"] and an["formats"][fld]["format"]:
            opts[f"{fld}_format"] = an["formats"][fld]["format"]
    r = client.post(f"/api/cases/{case_id}/imports", json={"file_id": f["id"], "kind": kind, "mapping": an["suggested_mapping"], "options": opts})
    assert r.status_code == 200, r.text
    imp = r.json()
    pv = client.post(f"/api/cases/{case_id}/imports/{imp['id']}/preview").json()
    assert not pv["required_problems"], pv
    run = client.post(f"/api/cases/{case_id}/imports/{imp['id']}/run")
    assert run.status_code == 200, run.text
    jobs = drain_jobs()
    assert all(j.status == "done" for j in jobs), [(j.type, j.status, j.message) for j in jobs]
    return an, client.get(f"/api/cases/{case_id}/imports/{imp['id']}").json()


def test_full_acceptance_flow(analyst, analyst2, reviewer, viewer, outsider, admin):
    # 1. criar caso
    r = analyst.post("/api/cases", json={"title": "Caso de teste de aceitação", "period_start": "2026-03-01", "period_end": "2026-03-31",
                                         "authorized_docs": "Decisão fictícia nº 1"})
    assert r.status_code == 200, r.text
    case = r.json()
    cid = case["id"]
    # 2. alvos
    for num, op in ((T1, "TIM"), (T2, "VIVO")):
        r = analyst.post(f"/api/cases/{cid}/targets", json={"number_original": num, "operator": op, "label": f"Alvo {num[-1]}"})
        assert r.status_code == 200, r.text
    assert analyst.post(f"/api/cases/{cid}/targets", json={"number_original": T1}).status_code == 409
    # 3–6. importar bilhetagem, mapear, validar, processar
    f1 = upload(analyst, cid, "TIM_teste.csv", cdr_csv_target1(), operator="TIM")
    an, imp1 = configure_and_run(analyst, cid, f1, "cdr", {"operator": "TIM", "target_number": N1, "tz_mode": "assumed", "tz_name": "America/Sao_Paulo"})
    assert an["operator_detection"]["operator"] == "TIM"
    assert an["suggested_mapping"]["a_number"] == "Número A" and an["suggested_mapping"]["cell_id"] == "CI"
    assert imp1["status"] == "done"
    assert imp1["rows_total"] == 9 and imp1["rows_error"] == 1 and imp1["rows_duplicate"] == 1 and imp1["rows_out_of_scope"] == 1
    f2 = upload(analyst, cid, "VIVO_teste.csv", cdr_csv_target2(), operator="VIVO")
    _, imp2 = configure_and_run(analyst, cid, f2, "cdr", {"operator": "VIVO", "target_number": N2, "tz_mode": "confirmed"})
    assert imp2["rows_ok"] == 3
    issues = analyst.get(f"/api/cases/{cid}/imports/{imp1['id']}/issues?severity=error").json()
    assert issues["total"] == 1 and issues["items"][0]["code"] == "data_invalida"
    # 7. consultar eventos (duplicados e fora do período excluídos por padrão)
    r = analyst.post(f"/api/cases/{cid}/events/search", json={"filter": {"targets": [T1]}, "size": 100}).json()
    assert r["total"] == 6
    assert all(e["file_id"] == f1["id"] and e["row_number"] for e in r["items"])
    r_all = analyst.post(f"/api/cases/{cid}/events/search", json={"filter": {"targets": [T1], "include_duplicates": True, "include_out_of_scope": True}}).json()
    assert r_all["total"] == 8
    night = analyst.post(f"/api/cases/{cid}/events/search", json={"filter": {"hour_from": 22, "hour_to": 5}}).json()
    assert night["total"] == 1
    # 8. estatísticas
    s = analyst.post(f"/api/cases/{cid}/analytics/summary", json={"filter": {"targets": [T1]}}).json()
    t = s["totals"]
    assert t["events"] == 6 and t["calls"] == 5 and t["sms"] == 1
    assert t["call_seconds"] == 60 + 120 + 30 + 180 + 40  # SMS não soma duração
    assert s["excluded"] == {"duplicates": 1, "out_of_scope": 1}
    c = analyst.post(f"/api/cases/{cid}/analytics/contacts", json={"filter": {"targets": [T1]}}).json()
    top = c["items"][0]
    assert top["other_number"] == "+5561980000001" and top["events"] == 3 and top["reciprocal"]
    # 9. comparar números
    cmp = analyst.post(f"/api/cases/{cid}/analytics/compare-numbers", json={"numbers": [T1, T2], "window_s": 120}).json()
    shared = {x["contact"] for x in cmp["common_contacts"]["shared"]}
    assert shared == {"+5561980000001", "+5561980000002"}
    assert any(d["a_number"] == N1 and d["b_number"] == N2 for d in cmp["direct_contacts"])
    assert len(cmp["coincidences"]["items"]) >= 1
    # cruzamento multifonte: a chamada T1→T2 aparece nos dois arquivos (1 s de diferença)
    x = analyst.post(f"/api/cases/{cid}/crossmatch/reciprocal", json={"tol_s": 60, "dur_tol_s": 5}).json()
    assert x["totals"].get("provavel", 0) + x["totals"].get("exata", 0) >= 1
    v = analyst.post(f"/api/cases/{cid}/crossmatch/validate", json={}).json()
    assert any(ch["check"] == "Fuso horário" and not ch["ok"] for ch in v["checks"])
    # 10–11. cadastro de ERB e resolução
    fe = upload(analyst, cid, "cadastro.csv", erb_csv(), kind="erb_registry")
    _, impe = configure_and_run(analyst, cid, fe, "erb_registry", {"operator": "TIM", "reference_date": "2026-03-01"})
    assert impe["rows_ok"] == 2
    cells = analyst.post(f"/api/cases/{cid}/erb/cells", json={}).json()
    by_key = {x["cell_key"]: x for x in cells["items"]}
    assert by_key["?|724|02|L1100|C20001"]["resolution_status"] == "exact"
    assert by_key["?|724|02|L1100|C29999"]["resolution_status"] == "none"
    assert by_key["?|724|02|L1100|C29999"]["lat"] is None  # coordenada nunca inventada
    assert by_key["CGI|724-02-1100-20001"]["resolution_status"] == "exact"
    # 12. dados geográficos
    g = analyst.post(f"/api/cases/{cid}/geo/points", json={}).json()
    assert len(g["registry_points"]) == 2 and "não a localização do aparelho" in g["criteria"]["limit_note"]
    seq = analyst.post(f"/api/cases/{cid}/geo/sequence", json={"filter": {"targets": [T1]}}).json()
    assert seq["items"][0]["coord_source"] == "cadastro"
    # 13. linha do tempo
    tl = analyst.post(f"/api/cases/{cid}/analytics/timeline", json={"filter": {}, "gap_hours": 12}).json()
    assert tl["events"]["total"] == 9 and tl["gaps"]
    # 14. rede de contatos
    gr = analyst.post(f"/api/cases/{cid}/analytics/graph", json={"filter": {}}).json()
    ids = {n["id"] for n in gr["nodes"]}
    assert {N1, N2, "+5561980000001"} <= ids
    edge = next(e for e in gr["edges"] if {e["n1"], e["n2"]} == {N1, N2})
    assert edge["events"] == 2  # um registro em cada arquivo
    # alertas
    rules = analyst.get(f"/api/cases/{cid}/alert-rules").json()
    assert len(rules["rules"]) >= 5
    analyst.post(f"/api/cases/{cid}/alerts/run", json={})
    drain_jobs()
    alerts = analyst.get(f"/api/cases/{cid}/alerts").json()
    assert any(a["rule_type"] == "duplicidades" for a in alerts)
    assert all(a["support_count"] >= 0 for a in alerts)
    # 15. relatório (PDF) + 16. origem verificável
    for fmt in ("pdf", "xlsx", "csv", "json", "html"):
        r = analyst.post(f"/api/cases/{cid}/reports", json={"report_type": "full", "fmt": fmt})
        assert r.status_code == 200, r.text
    jobs = drain_jobs()
    assert all(j.status == "done" for j in jobs), [(j.status, j.message) for j in jobs]
    reps = analyst.get(f"/api/cases/{cid}/reports").json()
    pdf = next(x for x in reps if x["fmt"] == "pdf")
    assert pdf["status"] == "rascunho" and len(pdf["sha256"]) == 64
    assert {f["sha256"] for f in pdf["input_files"]} >= {f1["sha256"], f2["sha256"]}
    d = analyst.get(f"/api/cases/{cid}/reports/{pdf['id']}/download")
    assert d.status_code == 200 and d.content[:4] == b"%PDF"
    assert hashlib.sha256(d.content).hexdigest() == pdf["sha256"]
    assert analyst.get(f"/api/cases/{cid}/reports/{pdf['id']}/verify").json()["intact"]
    ev = analyst.post(f"/api/cases/{cid}/events/search", json={"filter": {"targets": [T1]}, "size": 1}).json()["items"][0]
    det = analyst.get(f"/api/cases/{cid}/events/{ev['id']}").json()
    assert det["file"]["sha256"] == f1["sha256"] and det["event"]["raw"]
    # correção auditável não altera relatório emitido
    r = analyst.post(f"/api/cases/{cid}/events/{ev['id']}/correct", json={"field": "duration_s", "value": "61", "reason": "conferência com o original"})
    assert r.status_code == 200 and r.json()["revision"] == 1
    det = analyst.get(f"/api/cases/{cid}/events/{ev['id']}").json()
    assert det["corrections"][0]["old"] == "60" and det["event"]["raw"]["Duração"] == "00:01:00"
    assert analyst.get(f"/api/cases/{cid}/reports/{pdf['id']}/verify").json()["intact"]
    # revisão do relatório com segregação de funções
    assert analyst.post(f"/api/cases/{cid}/members", json={"user_id": user_id("revisor@teste.com.br"), "role": "reviewer"}).status_code == 200
    assert analyst.post(f"/api/cases/{cid}/reports/{pdf['id']}/review", json={"action": "submeter"}).json()["status"] == "em_revisao"
    assert analyst.post(f"/api/cases/{cid}/reports/{pdf['id']}/review", json={"action": "aprovar"}).status_code == 403
    assert reviewer.post(f"/api/cases/{cid}/reports/{pdf['id']}/review", json={"action": "aprovar", "note": "ok"}).json()["status"] == "aprovado"
    # 17. permissões
    assert analyst2.get(f"/api/cases/{cid}").status_code == 404
    assert outsider.get(f"/api/cases/{cid}").status_code == 404
    assert admin.get(f"/api/cases/{cid}").status_code == 404  # admin sem acesso automático ao conteúdo
    assert reviewer.post(f"/api/cases/{cid}/targets", json={"number_original": "(61) 90000-1009"}).status_code == 403
    assert reviewer.post(f"/api/cases/{cid}/events/export", json={"fmt": "csv"}).status_code == 403
    analyst.post(f"/api/cases/{cid}/members", json={"user_id": user_id("consulta@teste.com.br"), "role": "analyst", "can_export": True})
    assert viewer.get(f"/api/cases/{cid}").json()["my_role"] == "viewer"  # papel global limita o papel no caso
    assert viewer.post(f"/api/cases/{cid}/events/export", json={"fmt": "csv"}).status_code == 403
    exp = analyst.post(f"/api/cases/{cid}/events/export", json={"fmt": "csv", "filter": {"targets": [T1]}})
    assert exp.status_code == 200 and exp.text.count("\n") == 6 + 2
    # 18. auditoria
    au = analyst.get(f"/api/audit?case_id={cid}&size=500").json()
    actions = {a["action"] for a in au["items"]}
    assert {"caso.criado", "arquivo.recebido", "import.processado", "relatorio.gerado", "evento.corrigido", "eventos.exportados"} <= actions
    assert all("raw" not in str(a["details"]) or "[omitido]" in str(a["details"]) for a in au["items"])
    assert admin.get("/api/audit/verify").json()["ok"]
    assert analyst.get("/api/audit/verify").status_code == 403


def test_justification_required(analyst):
    cid = analyst.post("/api/cases", json={"title": "Caso com justificativa", "require_justification": True}).json()["id"]
    assert analyst.get(f"/api/cases/{cid}/targets").status_code == 428
    assert analyst.post(f"/api/cases/{cid}/justification", json={"justification": "Análise técnica do procedimento"}).status_code == 200
    assert analyst.get(f"/api/cases/{cid}/targets").status_code == 200


def test_demo_seed_and_clear(analyst):
    r = analyst.post("/api/demo/seed")
    assert r.status_code == 200
    jobs = drain_jobs()
    assert jobs[-1].status == "done", jobs[-1].message
    cases = analyst.get("/api/cases").json()
    demo = next(c for c in cases if c["is_demo"])
    assert demo["stats"]["events"] > 2000 and demo["stats"]["erb_cells"] > 50
    real_before = [c["id"] for c in cases if not c["is_demo"]]
    assert analyst.delete("/api/demo").json()["removed"]
    after = analyst.get("/api/cases").json()
    assert not any(c["is_demo"] for c in after)
    assert [c["id"] for c in after if not c["is_demo"]] == real_before


def test_multi_batch_import(analyst):
    """Arquivo maior que um lote de gravação (5.000 linhas): todos os lotes devem ser gravados."""
    cid = analyst.post("/api/cases", json={"title": "Volume multi-lote"}).json()["id"]
    lines = ["Número A;Número B;Data;Hora;Duração;Tipo"]
    for i in range(12_345):
        lines.append(f"(61) 90000-2001;(61) 98{i % 900:03d}-{i % 10000:04d};{1 + i % 28:02d}/03/2026;{i % 24:02d}:{i % 60:02d}:{(i * 7) % 60:02d};{i % 300};Originada")
    f = upload(analyst, cid, "grande.csv", "\n".join(lines).encode())
    _, imp = configure_and_run(analyst, cid, f, "cdr", {"tz_mode": "assumed"})
    assert imp["rows_total"] == 12_345 and imp["rows_ok"] + imp["rows_duplicate"] >= 12_345 - imp["rows_error"]
    total = analyst.post(f"/api/cases/{cid}/events/search", json={"filter": {"include_duplicates": True}, "size": 1}).json()["total"]
    assert total == imp["rows_ok"] == 12_345
