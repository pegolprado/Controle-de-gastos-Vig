"""Armazenamento privado de arquivos (fora do diretório público).

Originais são gravados uma única vez e marcados como somente leitura. Chaves são
aleatórias (não previsíveis) e nunca expostas como URL pública: o download passa
pela API, que verifica a permissão no caso.

Para produção em armazenamento de objetos, implemente outra classe com a mesma
interface (put_stream/open/path/delete) e selecione-a em `get_storage`.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import stat
from pathlib import Path
from typing import BinaryIO

from .config import settings


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root
        (root / "originals").mkdir(parents=True, exist_ok=True)
        (root / "reports").mkdir(parents=True, exist_ok=True)
        (root / "work").mkdir(parents=True, exist_ok=True)
        os.chmod(root, 0o700)

    def _new_key(self, area: str, suffix: str = "") -> str:
        token = secrets.token_hex(16)
        return f"{area}/{token[:2]}/{token}{suffix}"

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise ValueError("chave de armazenamento inválida")
        return p

    def put_stream(self, area: str, stream: BinaryIO, max_bytes: int, suffix: str = "") -> tuple[str, str, int]:
        """Grava o fluxo calculando SHA-256 e tamanho; aborta acima do limite."""
        key = self._new_key(area, suffix)
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        h = hashlib.sha256()
        size = 0
        try:
            with open(p, "xb") as out:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError("arquivo excede o tamanho máximo permitido")
                    h.update(chunk)
                    out.write(chunk)
        except BaseException:
            p.unlink(missing_ok=True)
            raise
        if area == "originals":
            os.chmod(p, stat.S_IRUSR)  # somente leitura: o original não é alterado
        return key, h.hexdigest(), size

    def put_bytes(self, area: str, data: bytes, suffix: str = "") -> tuple[str, str, int]:
        import io

        return self.put_stream(area, io.BytesIO(data), max_bytes=len(data) + 1, suffix=suffix)

    def open(self, key: str) -> BinaryIO:
        return open(self.path(key), "rb")

    def delete(self, key: str) -> None:
        p = self.path(key)
        if p.exists():
            os.chmod(p, stat.S_IRUSR | stat.S_IWUSR)
            p.unlink()


_storage: LocalStorage | None = None


def get_storage() -> LocalStorage:
    global _storage
    if _storage is None:
        _storage = LocalStorage(settings.storage_dir)
    return _storage


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()
