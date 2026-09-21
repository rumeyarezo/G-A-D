from __future__ import annotations

import os
from datetime import date
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .auth import Usuario, usuario_atual
from .forecast import Pendencia, Serie, projetar
from .importers import ErroImportacao, marcar_duplicados, parse_csv, parse_ofx

MAX_UPLOAD = 2 * 1024 * 1024  # 2 MB: um extrato mensal tem poucos KB

app = FastAPI(title="Grana a Dois — API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in os.environ.get("CORS_ORIGINS", "").split(",") if o],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

Autenticado = Annotated[Usuario, Depends(usuario_atual)]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/importar/extrato")
async def importar_extrato(
    _: Autenticado,
    arquivo: Annotated[UploadFile, File()],
    formato: Annotated[Literal["ofx", "csv"], Form()],
    positivo_e_despesa: Annotated[bool, Form()] = False,
    ja_existentes: Annotated[str, Form(description="ids_externos já importados, separados por vírgula")] = "",
) -> dict[str, object]:
    bruto = await arquivo.read(MAX_UPLOAD + 1)
    if len(bruto) > MAX_UPLOAD:
        raise HTTPException(413, "arquivo maior que 2 MB")
    try:
        texto = bruto.decode("utf-8")
    except UnicodeDecodeError:
        texto = bruto.decode("latin-1")  # muitos bancos ainda exportam em ISO-8859-1
    try:
        itens = parse_ofx(texto) if formato == "ofx" else parse_csv(texto, positivo_e_despesa)
    except ErroImportacao as e:
        raise HTTPException(422, str(e)) from e
    marcar_duplicados(itens, {x for x in ja_existentes.split(",") if x})
    return {
        "total": len(itens),
        "duplicados": sum(1 for i in itens if i.duplicado),
        "lancamentos": [i.to_dict() for i in itens],
    }


class SerieIn(BaseModel):
    tipo: Literal["receita", "despesa"]
    valor: int = Field(gt=0, description="centavos")
    ultima: date
    frequencia: Literal["semanal", "quinzenal", "mensal", "bimestral", "trimestral", "semestral", "anual", "personalizado"] = "mensal"
    vence_dia: int | Literal["ultimo"] | None = None
    intervalo_dias: int | None = Field(default=None, gt=0)
    desc: str = ""


class PendenciaIn(BaseModel):
    data: date
    valor: int = Field(description="centavos com sinal: entrada > 0, saída < 0")
    desc: str = ""


class ProjecaoIn(BaseModel):
    saldo_atual: int = Field(description="centavos")
    hoje: date
    horizonte_dias: int = Field(default=60, ge=1, le=366)
    series: list[SerieIn] = Field(default_factory=list, max_length=500)
    pendencias: list[PendenciaIn] = Field(default_factory=list, max_length=2000)


@app.post("/projecao")
def projecao(_: Autenticado, corpo: ProjecaoIn) -> dict[str, object]:
    p = projetar(
        corpo.saldo_atual,
        corpo.hoje,
        corpo.horizonte_dias,
        [Serie(**s.model_dump()) for s in corpo.series],
        [Pendencia(**x.model_dump()) for x in corpo.pendencias],
    )
    return {
        "saldo_final": p.saldo_final,
        "saldo_minimo": p.saldo_minimo,
        "dia_saldo_minimo": p.dia_saldo_minimo,
        "primeiro_dia_negativo": p.primeiro_dia_negativo,
        "dias": [{"data": d, "saldo": s} for d, s in p.dias],
    }
