"""Verificação do JWT do Supabase. O serviço NÃO tem chave de serviço nem acesso ao banco: só valida quem chama."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException, status


@dataclass(frozen=True)
class Usuario:
    id: str
    email: str | None


@lru_cache(maxsize=1)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True)


def verificar_token(token: str) -> Usuario:
    """
    Projetos novos do Supabase assinam com chave assimétrica (JWKS em /auth/v1/.well-known/jwks.json);
    projetos antigos usam segredo compartilhado HS256. Aceitamos o que estiver configurado:
      SUPABASE_URL          -> valida via JWKS (ES256/RS256)
      SUPABASE_JWT_SECRET   -> valida HS256
    """
    url, secret = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_JWT_SECRET")
    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
        if alg == "HS256":
            if not secret:
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "SUPABASE_JWT_SECRET não configurado")
            claims = jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
        elif alg in ("ES256", "RS256"):
            if not url:
                raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "SUPABASE_URL não configurado")
            key = _jwks_client(f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json").get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=[alg], audience="authenticated")
        else:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "algoritmo de token não aceito")
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token inválido ou expirado") from e
    if claims.get("role") != "authenticated" or not claims.get("sub"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token sem usuário autenticado")
    return Usuario(id=str(claims["sub"]), email=claims.get("email"))


def usuario_atual(authorization: str | None = Header(default=None)) -> Usuario:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "faltou o cabeçalho Authorization: Bearer <token>")
    return verificar_token(authorization.split(" ", 1)[1].strip())
