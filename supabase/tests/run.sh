#!/bin/bash
# Sobe um PostgreSQL descartável, aplica bootstrap + migrations e roda os testes SQL.
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
PGBIN=/usr/lib/postgresql/16/bin
WORK=${PGTEST_DIR:-/tmp/grana-pgtest}
PORT=${PGTEST_PORT:-54329}
rm -rf "$WORK"; mkdir -p "$WORK"
if [ "$(id -u)" = 0 ]; then chown -R claude "$WORK"; RUN="su claude -s /bin/bash -c"; else RUN="bash -c"; fi
$RUN "$PGBIN/initdb -D $WORK/data -U postgres --auth=trust >/dev/null"
$RUN "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK -c listen_addresses=' -l $WORK/log -w start >/dev/null"
trap "$RUN '$PGBIN/pg_ctl -D $WORK/data -m immediate stop >/dev/null' || true" EXIT
PSQL="psql -h $WORK -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database t" postgres
PSQL="$PSQL -d t"
$PSQL -f "$DIR/bootstrap.sql"
for f in "$DIR"/../migrations/0001*.sql "$DIR"/../migrations/0002*.sql; do echo "-- aplicando $(basename "$f")"; $PSQL -f "$f"; done
$PSQL -f "$DIR/test_schema.sql"
echo "-- aplicando 0003_security_hardening.sql"; $PSQL -f "$DIR"/../migrations/0003*.sql
$PSQL -f "$DIR/test_hardening.sql"
echo "-- aplicando 0005_categorias_padrao_e_zerar.sql"; $PSQL -f "$DIR"/../migrations/0005*.sql
$PSQL -f "$DIR/test_seed.sql"
$PSQL -f "$DIR"/../migrations/0006*.sql
echo "TODOS OS TESTES SQL PASSARAM"
