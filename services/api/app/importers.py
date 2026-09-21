"""Importação de extratos (OFX e CSV) → lançamentos em rascunho. Nada é gravado aqui: o app confere e grava."""
from __future__ import annotations

import csv
import hashlib
import io
import re
import unicodedata
from dataclasses import asdict, dataclass
from datetime import date, datetime

from .money import parse_money, to_cents
from .rules import sugerir_categoria, sugerir_forma


@dataclass
class LancamentoImportado:
    id_externo: str          # estável: o mesmo extrato importado 2x gera os mesmos ids (deduplicação)
    tipo: str                # 'despesa' | 'receita'
    desc: str
    valor: int               # centavos, sempre positivo
    data: str                # YYYY-MM-DD
    cat_id: str | None
    sub: str | None
    forma: str | None
    origem: str              # 'ofx' | 'csv'
    duplicado: bool = False

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class ErroImportacao(ValueError):
    pass


def _limpa(texto: str) -> str:
    return re.sub(r"\s+", " ", texto).strip()


def _hash_id(*partes: object) -> str:
    return hashlib.sha1("|".join(str(p) for p in partes).encode("utf-8")).hexdigest()[:20]


def _montar(origem: str, id_base: str, data: date, valor_cents: int, desc: str, ordinal: int) -> LancamentoImportado:
    desc = _limpa(desc) or "Lançamento importado"
    sug = sugerir_categoria(desc)
    # o mesmo texto/valor/dia pode acontecer legitimamente 2x no dia: o ordinal separa, e é estável no arquivo
    return LancamentoImportado(
        id_externo=_hash_id(origem, id_base, data.isoformat(), valor_cents, desc.lower(), ordinal),
        tipo="receita" if valor_cents > 0 else "despesa",
        desc=desc,
        valor=abs(valor_cents),
        data=data.isoformat(),
        cat_id=sug[0] if sug else None,
        sub=sug[1] if sug else None,
        forma=sugerir_forma(desc),
        origem=origem,
    )


def _numerar(itens: list[tuple[str, date, int, str]], origem: str) -> list[LancamentoImportado]:
    vistos: dict[tuple[str, date, int, str], int] = {}
    saida: list[LancamentoImportado] = []
    for id_base, d, v, desc in itens:
        chave = (id_base, d, v, _limpa(desc).lower())
        n = vistos.get(chave, 0)
        vistos[chave] = n + 1
        if v == 0:
            continue
        saida.append(_montar(origem, id_base, d, v, desc, n))
    return saida


# ----------------------------------------------------------------------------- OFX

_STMTTRN = re.compile(r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>)|(?=</BANKTRANLIST>)|$)", re.DOTALL | re.IGNORECASE)


def _tag(bloco: str, nome: str) -> str | None:
    m = re.search(rf"<{nome}>\s*([^<\r\n]*)", bloco, re.IGNORECASE)
    return m.group(1).strip() if m else None


def parse_ofx(texto: str) -> list[LancamentoImportado]:
    """OFX 1.x (SGML, sem tags de fechamento) e 2.x (XML). Sinal do TRNAMT: negativo = saída."""
    if "<OFX" not in texto.upper():
        raise ErroImportacao("Arquivo não parece ser OFX.")
    itens: list[tuple[str, date, int, str]] = []
    for m in _STMTTRN.finditer(texto):
        b = m.group(1)
        dt, amt = _tag(b, "DTPOSTED"), _tag(b, "TRNAMT")
        if not dt or amt is None:
            continue
        try:
            data = datetime.strptime(dt[:8], "%Y%m%d").date()  # noqa: DTZ007 - só a data importa
        except ValueError as e:
            raise ErroImportacao(f"Data inválida no OFX: {dt}") from e
        valor = parse_money(amt.replace(",", ".") if re.fullmatch(r"-?\d+,\d{1,2}", amt) else amt)
        if valor is None:
            raise ErroImportacao(f"Valor inválido no OFX: {amt}")
        desc = _tag(b, "MEMO") or _tag(b, "NAME") or ""
        itens.append((_tag(b, "FITID") or "", data, valor, desc))
    if not itens:
        raise ErroImportacao("Nenhuma transação encontrada no OFX.")
    return _numerar(itens, "ofx")


# ----------------------------------------------------------------------------- CSV

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


_COL_DATA = {"data", "date", "data lancamento", "data da compra", "data mov", "dt"}
_COL_DESC = {"descricao", "historico", "lancamento", "description", "title", "titulo", "estabelecimento", "memo", "detalhes"}
_COL_VALOR = {"valor", "amount", "value", "valor r", "quantia"}


def _parse_data(t: str) -> date:
    t = t.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y", "%d-%m-%Y"):
        try:
            return datetime.strptime(t, fmt).date()  # noqa: DTZ007 - só a data importa
        except ValueError:
            continue
    raise ErroImportacao(f"Data não reconhecida: {t!r}")


def parse_csv(texto: str, positivo_e_despesa: bool = False) -> list[LancamentoImportado]:
    """
    CSV de banco/cartão. Detecta separador (; ou ,) e as colunas de data/descrição/valor pelo cabeçalho.
    `positivo_e_despesa=True` para faturas de cartão (ex.: Nubank exporta compras como valor positivo).
    """
    texto = texto.lstrip("﻿")
    amostra = texto[:2000]
    delim = ";" if amostra.count(";") > amostra.count(",") else ","
    linhas = list(csv.reader(io.StringIO(texto), delimiter=delim))
    linhas = [l for l in linhas if any(c.strip() for c in l)]
    if len(linhas) < 2:
        raise ErroImportacao("CSV vazio ou sem linhas de dados.")
    cab = [_norm(c) for c in linhas[0]]

    def achar(opcoes: set[str]) -> int | None:
        for i, c in enumerate(cab):
            if c in opcoes:
                return i
        return None

    i_data, i_desc, i_val = achar(_COL_DATA), achar(_COL_DESC), achar(_COL_VALOR)
    if i_data is None or i_val is None:
        raise ErroImportacao(f"Não encontrei as colunas de data e valor. Cabeçalho lido: {linhas[0]}")

    itens: list[tuple[str, date, int, str]] = []
    for n, l in enumerate(linhas[1:], start=2):
        if len(l) <= max(i_data, i_val):
            raise ErroImportacao(f"Linha {n} com colunas faltando.")
        valor = parse_money(l[i_val])
        if valor is None:
            raise ErroImportacao(f"Linha {n}: valor inválido {l[i_val]!r}")
        if positivo_e_despesa:
            valor = -valor
        desc = l[i_desc] if i_desc is not None and i_desc < len(l) else ""
        itens.append(("", _parse_data(l[i_data]), valor, desc))
    return _numerar(itens, "csv")


def marcar_duplicados(novos: list[LancamentoImportado], ja_existentes: set[str]) -> list[LancamentoImportado]:
    for n in novos:
        n.duplicado = n.id_externo in ja_existentes
    return novos


__all__ = ["ErroImportacao", "LancamentoImportado", "marcar_duplicados", "parse_csv", "parse_ofx", "to_cents"]
