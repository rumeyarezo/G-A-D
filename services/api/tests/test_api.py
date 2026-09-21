import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import app

SECRET = "segredo-de-teste-com-32-bytes-ou-mais!!"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    monkeypatch.delenv("SUPABASE_URL", raising=False)


def token(**over):
    claims = {"sub": "11111111-1111-1111-1111-111111111111", "email": "a@x.com", "role": "authenticated",
              "aud": "authenticated", "exp": int(time.time()) + 300, **over}
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, SECRET, algorithm="HS256")


client = TestClient(app)
H = lambda t: {"Authorization": f"Bearer {t}"}

OFX = "<OFX><STMTTRN><DTPOSTED>20260910<TRNAMT>-89.90<FITID>1<MEMO>Uber\n</OFX>"


def test_health_e_publico():
    assert client.get("/health").json() == {"status": "ok"}


@pytest.mark.parametrize("hdr", [
    {}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer lixo"},
    H(token(exp=int(time.time()) - 10)),            # expirado
    H(token(aud="outra")),                          # audiência errada
    H(token(role="anon")),                          # papel errado
    H(token(sub=None)),                             # sem usuário
    H(jwt.encode({"sub": "x", "role": "authenticated", "aud": "authenticated", "exp": int(time.time()) + 99}, "outro-segredo-com-32-bytes-ou-mais!!", algorithm="HS256")),
])
def test_rotas_exigem_token_valido(hdr):
    r = client.post("/projecao", headers=hdr, json={"saldo_atual": 0, "hoje": "2026-09-18"})
    assert r.status_code == 401, r.text


def test_token_algoritmo_none_e_recusado():
    import base64
    import json
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    t = f"{b({'alg': 'none', 'typ': 'JWT'})}.{b({'sub': 'x', 'role': 'authenticated', 'aud': 'authenticated'})}."
    assert client.post("/projecao", headers=H(t), json={"saldo_atual": 0, "hoje": "2026-09-18"}).status_code == 401


def test_projecao_via_api():
    r = client.post("/projecao", headers=H(token()), json={
        "saldo_atual": 100000, "hoje": "2026-09-18", "horizonte_dias": 30,
        "series": [{"tipo": "receita", "valor": 500000, "ultima": "2026-09-05"}],
        "pendencias": [{"data": "2026-09-20", "valor": -31000}],
    })
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["saldo_final"] == 569000 and j["saldo_minimo"] == 69000
    assert j["dia_saldo_minimo"] == "2026-09-20" and len(j["dias"]) == 31


def test_projecao_valida_entrada():
    h = H(token())
    assert client.post("/projecao", headers=h, json={"saldo_atual": 0, "hoje": "2026-09-18", "horizonte_dias": 9999}).status_code == 422
    assert client.post("/projecao", headers=h, json={"saldo_atual": 0, "hoje": "2026-09-18", "series": [{"tipo": "receita", "valor": -5, "ultima": "2026-09-05"}]}).status_code == 422


def test_importar_extrato_ofx_e_duplicados():
    files = {"arquivo": ("extrato.ofx", OFX.encode(), "application/x-ofx")}
    r = client.post("/importar/extrato", headers=H(token()), files=files, data={"formato": "ofx"})
    assert r.status_code == 200, r.text
    lanc = r.json()["lancamentos"]
    assert lanc[0]["valor"] == 8990 and lanc[0]["cat_id"] == "transporte" and lanc[0]["duplicado"] is False
    r2 = client.post("/importar/extrato", headers=H(token()), files=files,
                     data={"formato": "ofx", "ja_existentes": lanc[0]["id_externo"]})
    assert r2.json()["duplicados"] == 1


def test_importar_extrato_latin1_e_erro_422():
    csv_latin1 = "Data;Descrição;Valor\n10/09/2026;Farmácia;-12,50\n".encode("latin-1")
    r = client.post("/importar/extrato", headers=H(token()), files={"arquivo": ("e.csv", csv_latin1)}, data={"formato": "csv"})
    assert r.status_code == 200 and r.json()["lancamentos"][0]["sub"] == "Farmácia"
    r = client.post("/importar/extrato", headers=H(token()), files={"arquivo": ("e.ofx", b"lixo")}, data={"formato": "ofx"})
    assert r.status_code == 422


def test_upload_grande_demais_e_recusado():
    r = client.post("/importar/extrato", headers=H(token()), files={"arquivo": ("e.csv", b"x" * (2 * 1024 * 1024 + 10))}, data={"formato": "csv"})
    assert r.status_code == 413
