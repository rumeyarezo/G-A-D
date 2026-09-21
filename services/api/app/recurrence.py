"""Recorrência — porta fiel de packages/core/src/recurrence.ts (verificada por shared/recurrence_vectors.json)."""
from __future__ import annotations

import calendar
from collections.abc import Iterator
from datetime import date, timedelta

MESES_POR_PASSO = {"mensal": 1, "bimestral": 2, "trimestral": 3, "semestral": 6, "anual": 12}
DIAS_POR_PASSO = {"semanal": 7, "quinzenal": 14}


def _last_day(y: int, m: int) -> int:
    return calendar.monthrange(y, m)[1]


def add_months_clamped(d: date, n: int, dia_alvo: int | str | None = None) -> date:
    total = d.year * 12 + (d.month - 1) + n
    y, m = divmod(total, 12)
    m += 1
    last = _last_day(y, m)
    if dia_alvo == "ultimo":
        wanted = last
    elif dia_alvo:
        wanted = int(dia_alvo)
    else:
        wanted = d.day
    return date(y, m, min(max(1, wanted), last))


def _normaliza_dia(v: int | str | None) -> int | str | None:
    if v is None or v == "":
        return None
    if v == "ultimo":
        return "ultimo"
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def proximo_vencimento(
    ultima: date,
    frequencia: str | None,
    hoje: date,
    vence_dia: int | str | None = None,
    intervalo_dias: int | None = None,
) -> date:
    """Primeira data ESTRITAMENTE depois de `hoje` na série que começa em `ultima`."""
    freq = frequencia or "mensal"
    dias_passo = max(1, int(intervalo_dias or 15)) if freq == "personalizado" else DIAS_POR_PASSO.get(freq)
    if dias_passo:
        passos = max(1, (hoje - ultima).days // dias_passo + 1)  # // é floor, como Math.floor
        return ultima + timedelta(days=passos * dias_passo)

    meses_passo = MESES_POR_PASSO.get(freq, 1)
    dia = _normaliza_dia(vence_dia)
    meses_entre = hoje.year * 12 + hoje.month - (ultima.year * 12 + ultima.month)
    k = max(1, meses_entre // meses_passo - 1)
    while add_months_clamped(ultima, k * meses_passo, dia) <= hoje:
        k += 1
    return add_months_clamped(ultima, k * meses_passo, dia)


def ocorrencias(
    ultima: date,
    frequencia: str | None,
    depois_de: date,
    ate: date,
    vence_dia: int | str | None = None,
    intervalo_dias: int | None = None,
) -> Iterator[date]:
    """Todas as datas da série no intervalo (depois_de, ate], sempre ancoradas na data original."""
    atual = proximo_vencimento(ultima, frequencia, depois_de, vence_dia, intervalo_dias)
    while atual <= ate:
        yield atual
        atual = proximo_vencimento(ultima, frequencia, atual, vence_dia, intervalo_dias)
