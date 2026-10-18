"""Assistente analítico LOCAL (determinístico).

Converte perguntas em português em filtros estruturados e verificáveis, executa a
consulta correspondente e descreve o resultado citando os números calculados.
Não usa serviços externos: nenhum dado sai do servidor. Toda resposta separa
o que é dado extraído, cálculo, correlação e o que depende de validação humana.

A integração com um modelo de linguagem externo NÃO está ativa; exigiria
avaliação de segurança, configuração explícita e autorização institucional.
"""
from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy.orm import Session

from ..parsers.text import strip_accents
from . import analytics as A
from .normalize import EVENT_TYPES, format_number, normalize_number

PERIODS = {
    "madrugada": (0, 5), "manha": (6, 11), "tarde": (12, 17), "noite": (18, 23),
}


def parse(question: str, case_targets: list[str]) -> tuple[A.EventFilter, str, list[str]]:
    q = strip_accents(question.lower())
    notes: list[str] = []
    f = A.EventFilter()
    nums = []
    for m in re.findall(r"\+?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}", question):
        n, _ = normalize_number(m)
        if n and n not in nums:
            nums.append(n)
    alvo_refs = re.findall(r"alvo\s+([a-z])\b", q)
    dates = re.findall(r"(\d{1,2}/\d{1,2}/\d{2,4})", q)
    parsed = []
    for d in dates:
        for fmt in ("%d/%m/%Y", "%d/%m/%y"):
            try:
                parsed.append(datetime.strptime(d, fmt))
                break
            except ValueError:
                pass
    if len(parsed) >= 2:
        f.date_from, f.date_to = min(parsed), max(parsed)
        notes.append(f"período de {f.date_from:%d/%m/%Y} a {f.date_to:%d/%m/%Y}")
    elif len(parsed) == 1:
        f.date_from = f.date_to = parsed[0]
        notes.append(f"data {parsed[0]:%d/%m/%Y}")
    m = re.search(r"entre\s+(\d{1,2})\s*h?\s*e\s+(\d{1,2})\s*h", q)
    if m:
        f.hour_from, f.hour_to = int(m.group(1)) % 24, int(m.group(2)) % 24
        notes.append(f"faixa horária {f.hour_from}h–{f.hour_to}h")
    else:
        for word, (h0, h1) in PERIODS.items():
            if re.search(rf"\b(de |a |pela |na |durante a )?{word}\b", q):
                f.hour_from, f.hour_to = h0, h1
                notes.append(f"{word} = {h0}h–{h1}h (horário do documento)")
                break
    types = []
    if re.search(r"\b(sms|mensage)", q):
        types += ["sms_enviado", "sms_recebido", "sms"]
    if re.search(r"\b(chamad|ligac|ligou|ligaram|voz)", q):
        if "originad" in q or "efetuad" in q or "fez" in q:
            types += ["voz_originada"]
        elif "recebid" in q:
            types += ["voz_recebida"]
        else:
            types += ["voz_originada", "voz_recebida", "voz"]
    if re.search(r"\b(dados|internet|conex)", q):
        types += ["dados"]
    if types:
        f.event_types = types
        notes.append("tipos: " + ", ".join(EVENT_TYPES.get(t, t) for t in types))
    m = re.search(r"(acima|mais) de\s+(\d+)\s*(min|seg|s\b)", q)
    if m:
        v = int(m.group(2))
        f.dur_min = v * 60 if m.group(3).startswith("min") else v
        notes.append(f"duração mínima {f.dur_min} s")
    intent = "list"
    if re.search(r"\bem comum\b|compartilh", q):
        intent = "common"
    elif re.search(r"mesma (erb|celula|antena)|mesmo local|juntos|coincid", q):
        intent = "coincidence"
    elif re.search(r"mais frequent|quem mais|principais contatos|top|ranking|frequencia", q):
        intent = "contacts"
    elif re.search(r"quant|total|resumo|estatistic|media|duracao total", q):
        intent = "summary"
    elif re.search(r"linha do tempo|cronolog|sequencia", q):
        intent = "timeline"
    if alvo_refs and case_targets:
        for ref in alvo_refs:
            idx = ord(ref) - ord("a")
            if 0 <= idx < len(case_targets) and case_targets[idx] not in nums:
                nums.append(case_targets[idx])
                notes.append(f"'alvo {ref.upper()}' interpretado como o {idx + 1}º alvo cadastrado ({format_number(case_targets[idx])})")
    if nums:
        if intent in ("common", "coincidence"):
            f.targets = nums
        elif len(nums) == 2 and intent in ("list", "summary"):
            f.numbers = nums
            notes.append("eventos envolvendo os números citados")
        else:
            f.numbers = nums
        notes.append("números: " + ", ".join(format_number(n) for n in nums))
    if not notes:
        notes.append("nenhum critério reconhecido: considerando todos os eventos do caso")
    return f, intent, notes


def answer(db: Session, case_id: int, question: str, case_targets: list[str]) -> dict:
    f, intent, notes = parse(question, case_targets)
    out: dict = {"intent": intent, "interpretation": notes, "filter": f.model_dump(mode="json", exclude_defaults=True),
                 "engine": "assistente local determinístico (sem envio de dados a serviços externos)"}
    lines: list[dict] = []
    if intent == "summary" or intent == "list":
        s = A.summary(db, case_id, f)
        t = s["totals"]
        lines.append({"kind": "dado", "text": f"{t['events']} eventos atendem aos critérios ({t['calls']} chamadas, {t['sms']} SMS, {t['data_sessions']} sessões de dados)."})
        if t["events"]:
            lines.append({"kind": "dado", "text": f"Primeiro evento em {t['first_event'][:19].replace('T', ' ')}, último em {t['last_event'][:19].replace('T', ' ')}, em {t['active_days']} dias distintos."})
            if t["call_seconds"]:
                lines.append({"kind": "calculo", "text": f"Duração total das chamadas: {int(t['call_seconds']) // 60} min; mediana de {t['call_median']} s (somente chamadas com duração > 0)."})
            if t["tz_not_confirmed"]:
                lines.append({"kind": "limite", "text": f"{t['tz_not_confirmed']} eventos têm fuso horário não confirmado."})
        out["result"] = {"totals": t}
    elif intent == "contacts":
        c = A.contacts(db, case_id, f, limit=10)
        for r in c["items"][:5]:
            lines.append({"kind": "calculo", "text": f"{format_number(r['other_number'])}: {r['events']} eventos em {r['days']} dias com {format_number(r['target_number'])} ({r['outgoing']} originados, {r['incoming']} recebidos)."})
        if not c["items"]:
            lines.append({"kind": "indisponivel", "text": "Nenhum interlocutor encontrado com os critérios."})
        lines.append({"kind": "limite", "text": c["criteria"]["note"]})
        out["result"] = c
    elif intent == "common":
        nums = f.targets or case_targets
        c = A.common_contacts(db, case_id, nums, f.model_copy(update={"targets": []}))
        lines.append({"kind": "calculo", "text": f"{len(c['shared'])} contatos em comum entre {len(c['numbers'])} números."})
        for r in c["shared"][:5]:
            lines.append({"kind": "dado", "text": f"{format_number(r['contact'])}: " + "; ".join(f"{format_number(k)} {v['n']}×" for k, v in r["per_number"].items())})
        lines.append({"kind": "limite", "text": "Contato em comum não indica relação entre os titulares."})
        out["result"] = c
    elif intent == "coincidence":
        nums = f.targets or case_targets
        same_cell = "erb" in strip_accents(question.lower()) or "celula" in strip_accents(question.lower()) or "antena" in question.lower()
        c = A.coincidences(db, case_id, nums, f.model_copy(update={"targets": []}), window_s=600, same_cell=same_cell, limit=200)
        lines.append({"kind": "correlacao", "text": f"{len(c['items'])} pares de eventos em janela de 10 minutos" + (" na mesma célula" if same_cell else "") + (" (lista truncada)" if c["truncated"] else "") + "."})
        lines.append({"kind": "hipotese", "text": "Coincidência de registros de rede é um indício para análise, não prova de presença física conjunta."})
        out["result"] = c
    elif intent == "timeline":
        t = A.timeline(db, case_id, f, size=50)
        lines.append({"kind": "dado", "text": f"{t['events']['total']} eventos na linha do tempo; {len(t['gaps'])} lacunas ≥ 12 h identificadas."})
        out["result"] = {"peaks": t["peaks"], "gaps": t["gaps"]}
    lines.append({"kind": "validacao", "text": "Confira os registros de origem antes de usar qualquer conclusão: use “Abrir registros”."})
    out["answer"] = lines
    return out
