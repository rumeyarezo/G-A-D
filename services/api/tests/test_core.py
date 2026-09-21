import json
from datetime import date
from pathlib import Path

import pytest

from app.forecast import Pendencia, Serie, projetar
from app.money import parse_money, to_cents
from app.recurrence import add_months_clamped, ocorrencias, proximo_vencimento
from app.rules import sugerir_banco, sugerir_categoria, sugerir_forma

SHARED = Path(__file__).resolve().parents[3] / "shared"


def iso(s: str) -> date:
    return date.fromisoformat(s)


# ------------------------------------------------------------------ dinheiro
def test_centavos_sem_erro_de_float():
    assert to_cents("44.90") == 4490
    assert to_cents("1.005") == 101          # meio para longe do zero (igual ao TypeScript)
    assert to_cents("-1.005") == -101
    assert to_cents("0.1") + to_cents("0.2") == to_cents("0.3")


@pytest.mark.parametrize("texto,esperado", [
    ("1.234,56", 123456), ("154,9", 15490), ("154.90", 15490), ("R$ 12", 1200), ("-89,90", -8990),
    ("(89,90)", -8990), ("1,234.56", 123456), ("+5", 500), ("", None), ("abc", None), ("12,345,6", None),
])
def test_parse_money(texto, esperado):
    assert parse_money(texto) == esperado


# ------------------------------------------------------------------ recorrência: Python == TypeScript
def test_recorrencia_identica_ao_typescript():
    casos = json.loads((SHARED / "recurrence_vectors.json").read_text())["casos"]
    assert len(casos) >= 600
    for c in casos:
        obtido = proximo_vencimento(iso(c["ultima"]), c["frequencia"], iso(c["hoje"]), c["venceDia"], c["intervaloDias"])
        assert obtido.isoformat() == c["esperado"], c


def test_mensal_dia_31_nao_deriva():
    assert proximo_vencimento(iso("2026-01-31"), "mensal", iso("2026-02-28")).isoformat() == "2026-03-31"
    assert add_months_clamped(iso("2028-01-31"), 1).isoformat() == "2028-02-29"


def test_ocorrencias_ancoradas_na_data_original():
    datas = [d.isoformat() for d in ocorrencias(iso("2026-01-31"), "mensal", iso("2026-01-31"), iso("2026-06-30"))]
    assert datas == ["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]


# ------------------------------------------------------------------ regras: Python == TypeScript
def test_regras_identicas_ao_typescript():
    v = json.loads((SHARED / "vectors.json").read_text())
    for texto, cat, sub in v["categoria"]:
        assert sugerir_categoria(texto) == ((cat, sub) if cat else None), texto
    for texto, forma in v["forma"]:
        assert sugerir_forma(texto) == forma, texto
    for texto, banco in v["banco"]:
        assert sugerir_banco(texto) == banco, texto


# ------------------------------------------------------------------ projeção
def test_projecao_saldo_dia_a_dia():
    p = projetar(
        saldo_atual=100_000, hoje=iso("2026-09-18"), horizonte_dias=30,
        series=[
            Serie("receita", 500_000, iso("2026-09-05")),            # salário: próximo 05/10
            Serie("despesa", 190_000, iso("2026-09-08"), vence_dia=8),  # aluguel: próximo 08/10
            Serie("despesa", 4_490, iso("2026-09-12"), "mensal"),    # assinatura: 12/10
        ],
        pendencias=[Pendencia(iso("2026-09-20"), -31_000, "energia")],
    )
    saldos = dict(p.dias)
    assert saldos[iso("2026-09-19")] == 100_000
    assert saldos[iso("2026-09-20")] == 69_000
    assert saldos[iso("2026-10-05")] == 569_000
    assert saldos[iso("2026-10-08")] == 379_000
    assert p.saldo_final == 69_000 + 500_000 - 190_000 - 4_490
    assert p.saldo_minimo == 69_000 and p.dia_saldo_minimo == iso("2026-09-20")
    assert p.primeiro_dia_negativo is None


def test_projecao_avisa_o_primeiro_dia_negativo():
    p = projetar(10_000, iso("2026-09-18"), 10, [], [Pendencia(iso("2026-09-22"), -15_000)])
    assert p.primeiro_dia_negativo == iso("2026-09-22")
    assert p.saldo_minimo == -5_000


def test_projecao_pendencia_atrasada_conta_hoje():
    p = projetar(50_000, iso("2026-09-18"), 5, [], [Pendencia(iso("2026-09-01"), -20_000)])
    assert dict(p.dias)[iso("2026-09-18")] == 30_000


def test_projecao_valida_horizonte():
    with pytest.raises(ValueError):
        projetar(0, iso("2026-09-18"), 0, [])
