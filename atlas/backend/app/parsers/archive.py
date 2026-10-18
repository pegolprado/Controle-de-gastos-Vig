"""Extração segura de ZIP: limita entradas, tamanho total e taxa de compressão
(proteção contra "zip bombs") e ignora caminhos absolutos ou com '..'."""
from __future__ import annotations

import zipfile
from collections.abc import Iterator
from pathlib import Path, PurePosixPath

from ..config import settings


class ArchiveError(ValueError):
    pass


def safe_entries(path: Path) -> Iterator[tuple[str, zipfile.ZipInfo]]:
    try:
        z = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        raise ArchiveError("ZIP corrompido ou inválido") from e
    with z:
        infos = [i for i in z.infolist() if not i.is_dir()]
        if len(infos) > settings.max_zip_entries:
            raise ArchiveError(f"ZIP com {len(infos)} arquivos excede o limite de {settings.max_zip_entries}")
        total = sum(i.file_size for i in infos)
        if total > settings.max_unzipped_mb * 1024 * 1024:
            raise ArchiveError("conteúdo descompactado excede o limite configurado")
        for info in infos:
            name = info.filename
            pp = PurePosixPath(name)
            if pp.is_absolute() or ".." in pp.parts or name.startswith("__MACOSX/"):
                continue
            if info.flag_bits & 0x1:
                raise ArchiveError("ZIP protegido por senha não é suportado; extraia antes de enviar")
            if info.compress_size and info.file_size / max(info.compress_size, 1) > settings.max_zip_ratio:
                raise ArchiveError(f"taxa de compressão suspeita em {name}")
            yield name, info


def open_entry(path: Path, info: zipfile.ZipInfo):
    z = zipfile.ZipFile(path)
    return z, z.open(info)
