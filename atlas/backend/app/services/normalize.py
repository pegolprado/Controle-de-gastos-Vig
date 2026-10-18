"""Regras de normalização (versionadas por RULES_VERSION).

Princípios:
- o valor original é sempre preservado ao lado do normalizado;
- campo ausente ou ilegível vira None + aviso — nunca é deduzido;
- a operadora NUNCA é inferida pelo prefixo do número (portabilidade numérica).
"""
from __future__ import annotations

import hashlib
import math
import re
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from ..parsers.text import norm_header, strip_accents

# ------------------------------------------------------------------ números


def normalize_number(raw: str | None) -> tuple[str | None, list[str]]:
    """Normaliza número brasileiro para E.164 (+55DDDNÚMERO) quando o formato é
    inequívoco. Retorna (normalizado, avisos). Não acrescenta o nono dígito."""
    warnings: list[str] = []
    if raw is None:
        return None, warnings
    s = str(raw).strip()
    if not s or s in {"-", "--", "0", "N/A", "n/a", "NA", "null", "NULL"}:
        return None, warnings
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    intl = s.startswith("+")
    digits = re.sub(r"\D", "", s)
    if not digits:
        return None, ["número sem dígitos"]
    if intl:
        if digits.startswith("55") and len(digits) in (12, 13):
            return "+" + digits, warnings
        return "+" + digits, warnings
    if digits.startswith("00") and len(digits) > 4:
        return "+" + digits[2:], warnings  # discagem internacional
    if digits.startswith("55") and len(digits) in (12, 13):
        return "+" + digits, warnings
    if digits.startswith("0") and len(digits) in (13, 14):  # 0 + CSP(2) + DDD + número
        return "+55" + digits[3:], ["código de prestadora (CSP) removido"]
    if digits.startswith("0") and len(digits) in (11, 12):  # 0 + DDD + número
        return "+55" + digits[1:], warnings
    if len(digits) in (10, 11) and digits[0] != "0":
        if len(digits) == 10 and digits[2] in "6789":
            warnings.append("possível celular sem o nono dígito (mantido como recebido)")
        return "+55" + digits, warnings
    if len(digits) <= 6:
        return digits, ["número curto / de serviço"]
    if len(digits) in (8, 9):
        return digits, ["número sem DDD"]
    return digits, ["formato de número não reconhecido (mantido como recebido)"]


def format_number(n: str | None) -> str:
    if not n:
        return ""
    if n.startswith("+55") and len(n) in (13, 14):
        ddd, rest = n[3:5], n[5:]
        return f"({ddd}) {rest[:-4]}-{rest[-4:]}"
    return n


# ------------------------------------------------------------------ datas

DATE_FORMATS = [
    "%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d", "%Y%m%d", "%m/%d/%Y",
]
TIME_FORMATS = ["%H:%M:%S", "%H:%M", "%H:%M:%S.%f", "%H%M%S", "%Hh%Mm%Ss"]
DATETIME_FORMATS = [f"{d} {t}" for d in DATE_FORMATS for t in TIME_FORMATS] + [
    "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y%m%d%H%M%S", "%d/%m/%Y - %H:%M:%S",
]

_ISO_OFFSET = re.compile(r"(Z|[+-]\d{2}:?\d{2})$")
_OFFSET_IN_TEXT = re.compile(r"(?:UTC|GMT)\s*([+-]\d{1,2})(?::?(\d{2}))?", re.I)


def _clean_dt_text(s: str) -> str:
    s = s.strip().replace("  ", " ")
    s = re.sub(r"\s+(BRT|BRST|UTC|GMT)([+-]\d.*)?$", "", s, flags=re.I)
    return s


def detect_format(values: list[str], candidates: list[str]) -> tuple[str | None, float, bool]:
    """Escolhe o formato que interpreta mais amostras. Retorna (formato, taxa, ambíguo)."""
    vals = [_clean_dt_text(v) for v in values if v and v.strip()]
    if not vals:
        return None, 0.0, False
    best, best_rate = None, 0.0
    rates = {}
    for fmt in candidates:
        ok = 0
        for v in vals:
            try:
                datetime.strptime(_ISO_OFFSET.sub("", v), fmt)
                ok += 1
            except ValueError:
                pass
        rates[fmt] = ok / len(vals)
        if rates[fmt] > best_rate:
            best, best_rate = fmt, rates[fmt]
    if best is None and all(_is_excel_serial(v) for v in vals):
        return "excel_serial", 1.0, False
    ambiguous = bool(best and "%d/%m" in best and rates.get(best.replace("%d/%m", "%m/%d"), 0) == best_rate)
    return best, best_rate, ambiguous


def _is_excel_serial(v: str) -> bool:
    try:
        x = float(v.replace(",", "."))
    except ValueError:
        return False
    return 20000 < x < 80000


def _from_excel_serial(v: str) -> datetime:
    x = float(v.replace(",", "."))
    return datetime(1899, 12, 30) + timedelta(days=x)


def parse_local_datetime(
    date_s: str | None, time_s: str | None, dt_s: str | None,
    date_fmt: str | None, time_fmt: str | None, dt_fmt: str | None,
) -> tuple[datetime | None, str | None, str | None]:
    """Retorna (datetime ingênuo como no documento, offset explícito '+HH:MM' ou None, erro)."""
    offset = None
    try:
        if dt_s and dt_s.strip():
            raw = dt_s.strip()
            m = _ISO_OFFSET.search(raw)
            if m and ("T" in raw or re.match(r"\d{4}-\d{2}-\d{2} ", raw)):
                offset = m.group(1)
                raw = raw[: m.start()]
            m2 = _OFFSET_IN_TEXT.search(raw)
            if m2:
                offset = f"{int(m2.group(1)):+03d}:{m2.group(2) or '00'}"
            raw = _clean_dt_text(raw)
            if dt_fmt == "excel_serial":
                return _from_excel_serial(raw), offset, None
            fmts = [dt_fmt] if dt_fmt else DATETIME_FORMATS
            for f in fmts:
                try:
                    return datetime.strptime(raw, f), offset, None
                except ValueError:
                    continue
            # data e hora com formato de data apenas (meia-noite) não é aceito silenciosamente
            return None, None, f"data/hora não reconhecida: {dt_s!r}"
        if date_s and date_s.strip():
            d_raw = date_s.strip()
            # planilhas às vezes trazem "2024-03-01 00:00:00" no campo de data
            if re.fullmatch(r"\d{4}-\d{2}-\d{2} 00:00:00", d_raw):
                d_raw = d_raw[:10]
            if date_fmt == "excel_serial":
                d = _from_excel_serial(d_raw)
            else:
                d = None
                for f in [date_fmt] if date_fmt else DATE_FORMATS:
                    try:
                        d = datetime.strptime(d_raw, f)
                        break
                    except ValueError:
                        continue
                if d is None:
                    return None, None, f"data não reconhecida: {date_s!r}"
            if time_s and time_s.strip():
                t_raw = time_s.strip()
                # hora vinda de planilha como "1900-01-01 13:45:00" ou fração do dia
                if re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", t_raw):
                    t_raw = t_raw[11:]
                elif re.fullmatch(r"0?[.,]\d+", t_raw):
                    secs = round(float(t_raw.replace(",", ".")) * 86400)
                    t_raw = f"{secs // 3600:02d}:{secs % 3600 // 60:02d}:{secs % 60:02d}"
                t = None
                for f in [time_fmt] if time_fmt else TIME_FORMATS:
                    try:
                        t = datetime.strptime(t_raw, f)
                        break
                    except ValueError:
                        continue
                if t is None:
                    return None, None, f"horário não reconhecido: {time_s!r}"
                return d.replace(hour=t.hour, minute=t.minute, second=t.second, microsecond=t.microsecond), None, None
            return d, None, "evento sem horário (somente data)"
    except (ValueError, OverflowError) as e:
        return None, None, f"data/hora inválida: {e}"
    return None, None, "data/hora ausente"


def to_utc(local: datetime, offset: str | None, tz_name: str | None) -> datetime:
    if offset:
        if offset == "Z":
            return local.replace(tzinfo=UTC)
        sign = 1 if offset[0] == "+" else -1
        hh, mm = offset[1:].replace(":", "")[:2], offset[1:].replace(":", "")[2:] or "00"
        delta = timedelta(hours=int(hh), minutes=int(mm)) * sign
        return (local - delta).replace(tzinfo=UTC)
    tz = ZoneInfo(tz_name or "America/Sao_Paulo")
    return local.replace(tzinfo=tz).astimezone(UTC)


# ------------------------------------------------------------------ duração


def parse_duration(raw: str | None, unit: str = "s") -> tuple[int | None, str | None]:
    if raw is None:
        return None, None
    s = str(raw).strip()
    if not s or s in {"-", "--"}:
        return None, None
    m = re.fullmatch(r"(\d+):(\d{1,2}):(\d{1,2})(?:[.,]\d+)?", s)
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)), None
    m = re.fullmatch(r"(\d+):(\d{1,2})", s)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2)), None
    m = re.fullmatch(r"(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?", s.lower())
    if m and any(m.groups()):
        h, mi, se = (int(x) if x else 0 for x in m.groups())
        return h * 3600 + mi * 60 + se, None
    # data-hora de planilha usada como duração (1899-12-30 00:01:23)
    m = re.fullmatch(r"(?:1899-12-3[01]|1900-01-0[01]) (\d{2}):(\d{2}):(\d{2})", s)
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)), None
    try:
        x = float(s.replace(",", "."))
    except ValueError:
        return None, f"duração não reconhecida: {raw!r}"
    if x < 0 or math.isnan(x):
        return None, f"duração inválida: {raw!r}"
    factor = {"s": 1, "min": 60, "ms": 0.001}.get(unit, 1)
    return int(round(x * factor)), None


# ------------------------------------------------------------------ tipos de evento

EVENT_TYPES = {
    "voz_originada": "Chamada originada",
    "voz_recebida": "Chamada recebida",
    "voz": "Chamada (sentido não informado)",
    "sms_enviado": "SMS enviado",
    "sms_recebido": "SMS recebido",
    "sms": "SMS (sentido não informado)",
    "dados": "Sessão de dados",
    "desvio": "Chamada desviada/encaminhada",
    "evento_rede": "Evento de rede",
    "outro": "Outro registro",
}

_OUT = ("originad", "efetuad", "sainte", "saida", "outgoing", " mo ", "orig", "enviad", "chamador")
_IN = ("recebid", "entrante", "entrada", "incoming", " mt ", "terminad", "term ", "receb")


def classify_direction(text: str | None) -> str:
    if not text:
        return "unknown"
    t = f" {strip_accents(text).lower()} "
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = f" {t.strip()} "
    if any(k in t for k in _OUT):
        return "out"
    if any(k in t for k in _IN):
        return "in"
    if t.strip() in {"s", "o", "out"}:
        return "out"
    if t.strip() in {"e", "r", "in"}:
        return "in"
    return "unknown"


def classify_event(
    type_text: str | None, direction_text: str | None, value_map: dict | None = None, default_type: str | None = None
) -> tuple[str, str, bool]:
    """Retorna (tipo_padrao, sentido, reconhecido).

    Sem coluna de tipo, usa `default_type` declarado pelo analista no assistente
    (ex.: extrato só de voz). Sem declaração, o tipo fica "outro" — não é presumido."""
    value_map = value_map or {}
    key = (type_text or "").strip()
    direction = classify_direction(direction_text) if direction_text else classify_direction(type_text)
    if key and key in value_map:
        et = value_map[key]
        if et in ("voz_originada", "sms_enviado"):
            direction = "out"
        elif et in ("voz_recebida", "sms_recebido"):
            direction = "in"
        return et, direction, True
    t = f" {norm_header(type_text or '')} "
    if not t.strip():
        base = default_type or "outro"
        if base in ("voz", "sms"):
            suffix = {"voz": ("voz_originada", "voz_recebida"), "sms": ("sms_enviado", "sms_recebido")}[base]
            return {"out": suffix[0], "in": suffix[1]}.get(direction, base), direction, True
        return base, direction, default_type is not None
    if any(k in t for k in (" sms ", " mensagem ", " torpedo ", " mms ")):
        return {"out": "sms_enviado", "in": "sms_recebido"}.get(direction, "sms"), direction, True
    if any(k in t for k in (" dados ", " gprs ", " data ", " internet ", " pacote ", " conexao ", " psd ", " ps ")):
        return "dados", "unknown", True
    if any(k in t for k in (" desvio ", " desviad", " encaminhad", " forward", " siga me ")):
        return "desvio", direction, True
    if any(k in t for k in (" atualizacao ", " location update ", " registro ", " attach ", " handover ", " evento de rede ")):
        return "evento_rede", "unknown", True
    if any(k in t for k in (" voz ", " chamada ", " call ", " ligacao ", " originada ", " recebida ", " mo ", " mt ", " moc ", " mtc ", " sainte ", " entrante ")):
        return {"out": "voz_originada", "in": "voz_recebida"}.get(direction, "voz"), direction, True
    return "outro", direction, False


# ------------------------------------------------------------------ células

TECH_ALIASES = {
    "2g": "2G", "gsm": "2G", "gprs": "2G", "edge": "2G",
    "3g": "3G", "umts": "3G", "wcdma": "3G", "hspa": "3G", "utran": "3G",
    "4g": "4G", "lte": "4G", "eutran": "4G", "e utran": "4G", "volte": "4G",
    "5g": "5G", "nr": "5G", "5g nr": "5G", "nsa": "5G", "sa": "5G",
}


def normalize_tech(raw: str | None) -> str | None:
    if not raw:
        return None
    t = norm_header(raw)
    if t in TECH_ALIASES:
        return TECH_ALIASES[t]
    for k, v in TECH_ALIASES.items():
        if len(k) > 2 and k in t:
            return v
    return None


def normalize_id(raw: str | None, hex_mode: bool = False) -> str | None:
    """Identificador numérico em decimal sem zeros à esquerda. Em modo hexadecimal
    converte; se o valor não for numérico, mantém o texto original (sem adivinhar)."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s in {"-", "--", "N/A", "NA", "null"}:
        return None
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    if hex_mode:
        h = s.lower().removeprefix("0x")
        if re.fullmatch(r"[0-9a-f]+", h):
            return str(int(h, 16))
        return s
    if s.lower().startswith("0x") and re.fullmatch(r"[0-9a-f]+", s[2:].lower()):
        return str(int(s[2:], 16))
    if s.isdigit():
        return str(int(s))
    return s


def normalize_cgi(raw: str | None) -> str | None:
    """CGI comparável: componentes decimais separados por '-'. Se vier concatenado
    (só dígitos) é mantido como está — a divisão em MCC/MNC/LAC/CI depende do layout."""
    if not raw:
        return None
    s = str(raw).strip()
    if not s or s in {"-", "--"}:
        return None
    parts = [p for p in re.split(r"[-.:/\s_]+", s) if p]
    if len(parts) >= 3 and all(p.isdigit() for p in parts):
        return "-".join(str(int(p)) if i > 1 else p for i, p in enumerate(parts))
    return re.sub(r"\s+", "", s).upper()


def split_cgi(cgi: str | None) -> dict:
    """Extrai componentes de um CGI separado ('724-02-1234-5678' ou '724-02-ECI')."""
    if not cgi or "-" not in cgi:
        return {}
    parts = cgi.split("-")
    if len(parts) == 4:
        return {"mcc": parts[0], "mnc": parts[1], "area": parts[2], "cid": parts[3]}
    if len(parts) == 3:
        return {"mcc": parts[0], "mnc": parts[1], "cid": parts[2]}
    return {}


def build_cell_key(tech, mcc, mnc, lac, tac, cell_id, eci, nci, cgi, erb_raw) -> str | None:
    """Chave de agrupamento por célula. Explicita cada componente; identificadores
    de tecnologias diferentes nunca produzem a mesma chave."""
    if nci:
        return f"5G|{mcc or '?'}|{mnc or '?'}|T{tac or '?'}|N{nci}"
    if eci:
        return f"4G|{mcc or '?'}|{mnc or '?'}|T{tac or '?'}|E{eci}"
    if cell_id:
        area = f"L{lac}" if lac else (f"T{tac}" if tac else "?")
        return f"{tech or '?'}|{mcc or '?'}|{mnc or '?'}|{area}|C{cell_id}"
    if cgi:
        return f"CGI|{cgi}"
    if erb_raw:
        return f"ERB|{str(erb_raw).strip().upper()}"
    return None


# ------------------------------------------------------------------ coordenadas

_DMS = re.compile(
    r"(-?\d+(?:[.,]\d+)?)\s*[°º:\s]\s*(\d+(?:[.,]\d+)?)?\s*['’:\s]?\s*(\d+(?:[.,]\d+)?)?\s*[\"”]?\s*([NSEWLO])?",
    re.I,
)


def parse_coord(raw: str | None, kind: str) -> tuple[float | None, str | None]:
    if raw is None:
        return None, None
    s = str(raw).strip()
    if not s or s in {"-", "--"}:
        return None, None
    try:
        v = float(s.replace(",", "."))
    except ValueError:
        m = _DMS.fullmatch(s.strip())
        if not m:
            return None, f"{kind} não reconhecida: {raw!r}"
        deg = float(m.group(1).replace(",", "."))
        mi = float((m.group(2) or "0").replace(",", "."))
        se = float((m.group(3) or "0").replace(",", "."))
        v = abs(deg) + mi / 60 + se / 3600
        hemi = (m.group(4) or "").upper()
        if deg < 0 or hemi in ("S", "W", "O"):
            v = -v
    limit = 90 if kind == "latitude" else 180
    if not -limit <= v <= limit:
        # coordenada em micrograus/inteiro (ex.: -23550520) — só converte se inequívoco
        if abs(v) > 1e5 and -limit <= v / 1e6 <= limit:
            return v / 1e6, f"{kind} convertida de micrograus"
        return None, f"{kind} fora do intervalo válido: {raw!r}"
    return v, None


def coords_issue(lat: float | None, lon: float | None) -> str | None:
    if lat is None or lon is None:
        return None
    if lat == 0 and lon == 0:
        return "coordenada 0,0 (inválida)"
    if not (-34.0 <= lat <= 5.5 and -74.5 <= lon <= -28.5):
        return "coordenada fora do território brasileiro (verificar)"
    return None


def parse_int(raw: str | None) -> int | None:
    if raw is None:
        return None
    s = re.sub(r"[^\d]", "", str(raw).split(",")[0].split(".")[0]) if not str(raw).strip().isdigit() else str(raw).strip()
    return int(s) if s else None


def dedup_hash(*parts) -> str:
    return hashlib.sha1("|".join("" if p is None else str(p) for p in parts).encode()).hexdigest()


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ------------------------------------------------------------------ operadora

_OPERATOR_PATTERNS = {
    "TIM": [r"\btim\b", r"tim s\.?a", r"tim celular", r"tim brasil", r"intelig"],
    "VIVO": [r"\bvivo\b", r"telef[oô]nica", r"telefonica brasil"],
    "CLARO": [r"\bclaro\b", r"embratel", r"\bnet servi"],
    "OI": [r"\boi\b s\.?a", r"telemar", r"\boi movel\b"],
}

# MNCs brasileiros (referência pública da Anatel). Usado só como indício fraco:
# um arquivo pode conter registros de rede de outra prestadora (roaming).
_MNC_HINT = {"02": "TIM", "03": "TIM", "04": "TIM", "05": "CLARO", "06": "VIVO", "10": "VIVO", "11": "VIVO", "23": "VIVO", "16": "OI", "24": "OI", "31": "OI"}


def detect_operator(filename: str, preamble: list[str], columns: list[str], sample_mnc: list[str]) -> dict:
    scores: dict[str, float] = {}
    evidence: list[str] = []
    text_sources = [("nome do arquivo", filename), ("cabeçalho do documento", " ".join(preamble)), ("colunas", " ".join(columns))]
    for src, text in text_sources:
        low = strip_accents(text or "").lower()
        for op, pats in _OPERATOR_PATTERNS.items():
            for p in pats:
                if re.search(strip_accents(p), low):
                    w = {"nome do arquivo": 0.35, "cabeçalho do documento": 0.5, "colunas": 0.2}[src]
                    scores[op] = scores.get(op, 0) + w
                    evidence.append(f"'{p.strip(chr(92)+'b')}' em {src}")
                    break
    mncs = [str(int(m)).zfill(2) for m in sample_mnc if m and str(m).strip().isdigit()]
    if mncs:
        top = max(set(mncs), key=mncs.count)
        op = _MNC_HINT.get(top)
        if op:
            scores[op] = scores.get(op, 0) + 0.25
            evidence.append(f"MNC predominante {top} (indício fraco)")
    if not scores:
        return {"operator": None, "confidence": 0.0, "evidence": ["nenhum indício encontrado"], "alternatives": {}}
    best = max(scores, key=scores.get)
    total = sum(scores.values())
    conf = min(0.99, scores[best] / max(total, 1e-9) * min(1.0, scores[best]))
    return {"operator": best, "confidence": round(conf, 2), "evidence": evidence, "alternatives": scores}


def now_utc() -> datetime:
    return datetime.now(UTC)
