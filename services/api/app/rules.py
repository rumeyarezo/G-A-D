"""Regras de categorização — lidas do MESMO arquivo que o TypeScript (shared/rules.json)."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

RULES_PATH = Path(__file__).resolve().parents[3] / "shared" / "rules.json"


@lru_cache(maxsize=1)
def _rules() -> dict[str, list[list[str]]]:
    data: dict[str, list[list[str]]] = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    return data


@lru_cache(maxsize=1)
def _compiled() -> tuple[list[tuple[re.Pattern[str], str, str]], list[tuple[re.Pattern[str], str]], list[tuple[re.Pattern[str], str]]]:
    r = _rules()
    flags = re.IGNORECASE
    return (
        [(re.compile(p, flags), c, s) for p, c, s in r["categoria"]],
        [(re.compile(p, flags), f) for p, f in r["forma"]],
        [(re.compile(p, flags), b) for p, b in r["banco"]],
    )


def sugerir_categoria(desc: str) -> tuple[str, str] | None:
    for rx, cat, sub in _compiled()[0]:
        if rx.search(desc or ""):
            return cat, sub
    return None


def sugerir_forma(desc: str) -> str | None:
    for rx, forma in _compiled()[1]:
        if rx.search(desc or ""):
            return forma
    return None


def sugerir_banco(desc: str) -> str | None:
    for rx, banco in _compiled()[2]:
        if rx.search(desc or ""):
            return banco
    return None
