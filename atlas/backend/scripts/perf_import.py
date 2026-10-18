"""Teste de volume: gera N registros sintéticos (CSV) e importa pelo pipeline real.

Uso: python scripts/perf_import.py 100000 [1000000 ...]
Exige DATABASE_URL e STORAGE_DIR. Cria um caso de DEMONSTRAÇÃO por volume e mede
leitura+normalização+gravação (COPY), deduplicação, resolução de ERB e consultas.
"""
from __future__ import annotations

import os
import random
import resource
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.config import RULES_VERSION  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Case, Import, Organization, SourceFile, Target, User  # noqa: E402
from app.parsers.fields import suggest_mapping  # noqa: E402
from app.parsers.readers import sniff_format  # noqa: E402
from app.services import analytics as A  # noqa: E402
from app.services import erb, importer  # noqa: E402
from app.services.demo import _NullCtx  # noqa: E402
from app.storage import get_storage  # noqa: E402


def gen_csv(path: Path, n: int) -> None:
    rng = random.Random(7)
    start = datetime(2026, 1, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write("Número A;Número B;Data;Hora;Duração;Tipo;MCC;MNC;LAC;CI\n")
        for i in range(n):
            ts = start + timedelta(seconds=int(i * (86400 * 90 / n)) + rng.randint(0, 30))
            other = f"619{80000000 + rng.randint(0, 5000):08d}"
            out = rng.random() < 0.55
            a, b = ("61900000009", other) if out else (other, "61900000009")
            tipo = rng.choice(["Originada", "Recebida", "SMS Originado"]) if out else rng.choice(["Recebida", "SMS Recebido"])
            f.write(f"{a};{b};{ts:%d/%m/%Y};{ts:%H:%M:%S};{rng.randint(0, 900)};{tipo};724;02;{1100 + rng.randint(0, 9)};{20000 + rng.randint(0, 400)}\n")


def run(n: int) -> dict:
    tmp = Path(os.environ.get("STORAGE_DIR", ".")) / f"perf_{n}.csv"
    t0 = time.perf_counter()
    gen_csv(tmp, n)
    gen_s = time.perf_counter() - t0
    with SessionLocal() as db:
        org = db.execute(select(Organization)).scalars().first() or Organization(name="Perf")
        db.add(org)
        db.flush()
        user = db.execute(select(User)).scalars().first()
        case = Case(organization_id=org.id, code=f"DEMO-PERF-{n}-{int(time.time())}", title=f"Teste de volume {n} (DEMONSTRAÇÃO)", is_demo=True,
                    period_start=date(2026, 1, 1), period_end=date(2026, 12, 31))
        db.add(case)
        db.flush()
        db.add(Target(case_id=case.id, number_normalized="+5561900000009", number_original="61900000009"))
        with open(tmp, "rb") as fh:
            key, sha, size = get_storage().put_stream("originals", fh, 10**11)
        sf = SourceFile(case_id=case.id, original_name=tmp.name, size_bytes=size, sha256=sha, detected_format=sniff_format(get_storage().path(key)),
                        storage_key=key, kind="cdr", operator_declared="TIM")
        db.add(sf)
        db.flush()
        cols = importer.open_table(sf, {}).info.columns
        imp = Import(case_id=case.id, file_id=sf.id, kind="cdr", mapping=suggest_mapping(cols), rules_version=RULES_VERSION,
                     options={"operator": "TIM", "target_number": "+5561900000009", "tz_mode": "assumed", "date_format": "%d/%m/%Y", "time_format": "%H:%M:%S"},
                     created_by=user.id if user else None)
        db.add(imp)
        db.commit()
        t1 = time.perf_counter()
        res = importer.run_cdr_import(_NullCtx(db), imp)
        imp_s = time.perf_counter() - t1
        t2 = time.perf_counter()
        erb.run_resolution(db, case.id, None, None)
        res_s = time.perf_counter() - t2
        f = A.EventFilter()
        q = {}
        for name, fn in (("resumo", lambda: A.summary(db, case.id, f)), ("contatos", lambda: A.contacts(db, case.id, f)),
                         ("pagina_eventos", lambda: A.list_events(db, case.id, f, page=500, size=50)),
                         ("grafo", lambda: A.link_graph(db, case.id, f, min_events=5)), ("linha_do_tempo", lambda: A.timeline(db, case.id, f))):
            t = time.perf_counter()
            fn()
            q[name] = round(time.perf_counter() - t, 2)
    tmp.unlink(missing_ok=True)
    return {"registros": n, "geracao_csv_s": round(gen_s, 1), "importacao_s": round(imp_s, 1), "registros_por_s": int(n / imp_s),
            "resolucao_erb_s": round(res_s, 1), "consultas_s": q, "aceitos": res["ok"],
            "pico_memoria_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)}


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        print(run(int(arg)), flush=True)
