"""Projeção de saldo dia a dia a partir do saldo atual, das séries recorrentes e das pendências."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from .recurrence import ocorrencias


@dataclass
class Serie:
    tipo: str                         # 'receita' | 'despesa'
    valor: int                        # centavos, positivo
    ultima: date                      # data da última ocorrência já lançada
    frequencia: str = "mensal"
    vence_dia: int | str | None = None
    intervalo_dias: int | None = None
    desc: str = ""


@dataclass
class Pendencia:
    data: date
    valor: int                        # centavos COM SINAL (entrada > 0, saída < 0)
    desc: str = ""


@dataclass
class Projecao:
    dias: list[tuple[date, int]] = field(default_factory=list)
    saldo_minimo: int = 0
    dia_saldo_minimo: date | None = None
    primeiro_dia_negativo: date | None = None
    saldo_final: int = 0


def projetar(
    saldo_atual: int,
    hoje: date,
    horizonte_dias: int,
    series: list[Serie],
    pendencias: list[Pendencia] | None = None,
) -> Projecao:
    if horizonte_dias < 1 or horizonte_dias > 366:
        raise ValueError("horizonte_dias deve estar entre 1 e 366")
    fim = hoje + timedelta(days=horizonte_dias)
    movimentos: dict[date, int] = {}

    def somar(d: date, v: int) -> None:
        movimentos[d] = movimentos.get(d, 0) + v

    for s in series:
        sinal = 1 if s.tipo == "receita" else -1
        for d in ocorrencias(s.ultima, s.frequencia, hoje, fim, s.vence_dia, s.intervalo_dias):
            somar(d, sinal * s.valor)
    for p in pendencias or []:
        if hoje < p.data <= fim:
            somar(p.data, p.valor)
        elif p.data <= hoje:            # já venceu e não foi baixada: conta como saída/entrada de hoje
            somar(hoje, p.valor)

    proj = Projecao(saldo_minimo=saldo_atual, dia_saldo_minimo=hoje)
    saldo = saldo_atual + movimentos.get(hoje, 0)
    proj.dias.append((hoje, saldo))
    if saldo < proj.saldo_minimo:
        proj.saldo_minimo, proj.dia_saldo_minimo = saldo, hoje
    if saldo < 0:
        proj.primeiro_dia_negativo = hoje
    d = hoje
    while d < fim:
        d += timedelta(days=1)
        saldo += movimentos.get(d, 0)
        proj.dias.append((d, saldo))
        if saldo < proj.saldo_minimo:
            proj.saldo_minimo, proj.dia_saldo_minimo = saldo, d
        if saldo < 0 and proj.primeiro_dia_negativo is None:
            proj.primeiro_dia_negativo = d
    proj.saldo_final = saldo
    return proj
