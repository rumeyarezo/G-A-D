"""Dinheiro em CENTAVOS inteiros (nunca float). Mesma regra do pacote TypeScript."""
from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

_MILHAR_BR = re.compile(r"^\d{1,3}(\.\d{3})+(,\d{1,2})?$")
_MILHAR_US = re.compile(r"^\d{1,3}(,\d{3})+(\.\d{1,2})?$")


def to_cents(valor: Decimal | int | str) -> int:
    """Converte reais (Decimal/str/int) em centavos, arredondando meio-para-longe-do-zero."""
    d = valor if isinstance(valor, Decimal) else Decimal(str(valor))
    return int((d * 100).to_integral_value(rounding=ROUND_HALF_UP))


def parse_money(texto: str) -> int | None:
    """Lê "1.234,56", "1,234.56", "-89,90", "(89,90)", "R$ 12", "154.90". None se não for dinheiro."""
    t = texto.strip().replace("R$", "").replace(" ", "").replace(" ", "")
    if not t:
        return None
    negativo = False
    if t.startswith("(") and t.endswith(")"):
        negativo, t = True, t[1:-1]
    if t.startswith("-"):
        negativo, t = True, t[1:]
    elif t.startswith("+"):
        t = t[1:]
    try:
        if _MILHAR_BR.match(t):
            d = Decimal(t.replace(".", "").replace(",", "."))
        elif _MILHAR_US.match(t):
            d = Decimal(t.replace(",", ""))
        elif re.fullmatch(r"\d+,\d{1,2}", t):
            d = Decimal(t.replace(",", "."))
        elif re.fullmatch(r"\d+(\.\d{1,2})?", t):
            d = Decimal(t)
        else:
            return None
    except InvalidOperation:
        return None
    c = to_cents(d)
    return -c if negativo else c
