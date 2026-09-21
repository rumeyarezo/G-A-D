import pytest

from app.importers import ErroImportacao, marcar_duplicados, parse_csv, parse_ofx

OFX_SGML = """OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260910120000[-3:BRT]<TRNAMT>-89.90<FITID>A1<MEMO>PADARIA CENTRAL
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260905<TRNAMT>7200.00<FITID>A2<MEMO>SALARIO EMPRESA
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260911<TRNAMT>-32.90<FITID>A3<NAME>UBER *TRIP
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260911<TRNAMT>-32.90<FITID>A3<NAME>UBER *TRIP
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"""

OFX_XML = """<?xml version="1.0"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260918</DTPOSTED><TRNAMT>-1234,56</TRNAMT><FITID>X</FITID><MEMO>Aluguel</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"""


def test_ofx_sgml_sinal_data_e_categoria():
    itens = parse_ofx(OFX_SGML)
    assert len(itens) == 4
    padaria, salario, uber1, uber2 = itens
    assert (padaria.tipo, padaria.valor, padaria.data) == ("despesa", 8990, "2026-09-10")
    assert (salario.tipo, salario.valor, salario.cat_id, salario.sub) == ("receita", 720000, "trabalho", "Salário")
    assert (uber1.cat_id, uber1.sub) == ("transporte", "Uber / 99")
    # duas viagens idênticas no mesmo dia continuam sendo DUAS transações, com ids distintos
    assert uber1.id_externo != uber2.id_externo


def test_ofx_xml_com_virgula_decimal():
    (a,) = parse_ofx(OFX_XML)
    assert (a.tipo, a.valor, a.cat_id) == ("despesa", 123456, "moradia")


def test_importar_o_mesmo_arquivo_duas_vezes_gera_os_mesmos_ids():
    ids1 = [i.id_externo for i in parse_ofx(OFX_SGML)]
    ids2 = [i.id_externo for i in parse_ofx(OFX_SGML)]
    assert ids1 == ids2 and len(set(ids1)) == len(ids1)
    novos = marcar_duplicados(parse_ofx(OFX_SGML), set(ids1[:2]))
    assert [n.duplicado for n in novos] == [True, True, False, False]


def test_ofx_invalido():
    with pytest.raises(ErroImportacao):
        parse_ofx("isto não é ofx")
    with pytest.raises(ErroImportacao):
        parse_ofx("<OFX></OFX>")


CSV_BR = """Data;Descrição;Valor
10/09/2026;PADARIA CENTRAL;-89,90
05/09/2026;SALÁRIO;7.200,00
18/09/2026;Aluguel;-1.900,00
"""

CSV_NUBANK = """date,title,amount
2026-09-12,Netflix,44.90
2026-09-10,Supermercado Pão de Açúcar,640.00
"""


def test_csv_extrato_brasileiro():
    a, b, c = parse_csv(CSV_BR)
    assert (a.tipo, a.valor, a.data) == ("despesa", 8990, "2026-09-10")
    assert (b.tipo, b.valor) == ("receita", 720000)
    assert (c.valor, c.cat_id, c.sub) == (190000, "moradia", "Aluguel")


def test_csv_fatura_de_cartao_positivo_e_despesa():
    a, b = parse_csv(CSV_NUBANK, positivo_e_despesa=True)
    assert (a.tipo, a.valor, a.cat_id) == ("despesa", 4490, "assinaturas")
    assert (b.tipo, b.valor, b.cat_id) == ("despesa", 64000, "alimentacao")


def test_csv_erros_claros():
    with pytest.raises(ErroImportacao, match="colunas de data e valor"):
        parse_csv("foo;bar\n1;2\n")
    with pytest.raises(ErroImportacao, match="valor inválido"):
        parse_csv("data;valor\n10/09/2026;abc\n")
    with pytest.raises(ErroImportacao, match="Data não reconhecida"):
        parse_csv("data;valor\n31/02/2026;10,00\n")
    with pytest.raises(ErroImportacao):
        parse_csv("data;valor\n")


def test_valor_zero_e_ignorado():
    itens = parse_csv("data;descricao;valor\n10/09/2026;Ajuste;0,00\n11/09/2026;Cafe;-5,00\n")
    assert [i.desc for i in itens] == ["Cafe"]
