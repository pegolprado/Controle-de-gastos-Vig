"""Utilidades de texto compartilhadas pelos leitores."""
from __future__ import annotations

import re
import unicodedata


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm_header(s: object) -> str:
    """'Duração (s)' -> 'duracao s'; usado para comparar cabeçalhos com sinônimos."""
    t = strip_accents(str(s or "")).lower()
    t = re.sub(r"[_\-/\\.:()\[\]#]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def cell_to_str(v: object) -> str:
    """Converte valor de planilha em texto sem perder informação (12.0 -> '12')."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, float):
        if v.is_integer() and abs(v) < 1e15:
            return str(int(v))
        return repr(v)
    if hasattr(v, "isoformat"):
        return v.isoformat(sep=" ") if hasattr(v, "hour") else v.isoformat()
    return str(v).strip()
