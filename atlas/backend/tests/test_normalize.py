from datetime import datetime

import pytest

from app.services import normalize as N


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("(61) 99999-0001", "+5561999990001"),
        ("61999990001", "+5561999990001"),
        ("+55 61 99999-0001", "+5561999990001"),
        ("5561999990001", "+5561999990001"),
        ("061999990001", "+5561999990001"),
        ("01561999990001", "+5561999990001"),  # 0 + CSP + DDD + número
        ("0016505551234", "+16505551234"),  # internacional
        ("61999990001.0", "+5561999990001"),  # vindo de planilha como número
        ("190", "190"),
        ("", None),
        (None, None),
    ],
)
def test_normalize_number(raw, expected):
    assert N.normalize_number(raw)[0] == expected


def test_number_does_not_add_ninth_digit():
    n, w = N.normalize_number("6188880001")
    assert n == "+556188880001"
    assert any("nono dígito" in x for x in w)


@pytest.mark.parametrize(
    "raw,unit,expected",
    [("00:01:30", "s", 90), ("1:02:03", "s", 3723), ("02:05", "s", 125), ("45", "s", 45), ("1,5", "min", 90),
     ("1500", "ms", 2), ("2m 5s", "s", 125), ("1899-12-30 00:01:23", "s", 83), ("", "s", None)],
)
def test_duration(raw, unit, expected):
    assert N.parse_duration(raw, unit)[0] == expected


def test_duration_invalid():
    v, err = N.parse_duration("abc")
    assert v is None and err


def test_datetime_formats_and_offsets():
    d, off, err = N.parse_local_datetime("05/03/2026", "14:30:00", None, None, None, None)
    assert d == datetime(2026, 3, 5, 14, 30) and off is None and err is None
    d, off, _ = N.parse_local_datetime(None, None, "2026-03-05T14:30:00-03:00", None, None, None)
    assert d == datetime(2026, 3, 5, 14, 30) and off == "-03:00"
    assert N.to_utc(d, off, None).hour == 17
    d, off, _ = N.parse_local_datetime(None, None, "20260305 143000", None, None, None)
    assert d == datetime(2026, 3, 5, 14, 30)
    d, _, err = N.parse_local_datetime("31/02/2026", "10:00", None, None, None, None)
    assert d is None and "não reconhecida" in err
    d, _, err = N.parse_local_datetime("05/03/2026", None, None, None, None, None)
    assert d == datetime(2026, 3, 5) and "sem horário" in err
    # serial de data do Excel
    d, _, _ = N.parse_local_datetime(None, None, "46086.5", None, None, "excel_serial")
    assert d.year == 2026 and d.hour == 12


def test_detect_date_format_ambiguity():
    fmt, rate, ambiguous = N.detect_format(["01/02/2026", "03/04/2026"], N.DATE_FORMATS)
    assert fmt == "%d/%m/%Y" and rate == 1 and ambiguous
    fmt, _, ambiguous = N.detect_format(["25/02/2026", "03/04/2026"], N.DATE_FORMATS)
    assert fmt == "%d/%m/%Y" and not ambiguous


def test_dst_aware_conversion():
    # 2018: horário de verão em São Paulo (UTC-2)
    assert N.to_utc(datetime(2018, 12, 1, 12), None, "America/Sao_Paulo").hour == 14
    assert N.to_utc(datetime(2026, 3, 1, 12), None, "America/Sao_Paulo").hour == 15


@pytest.mark.parametrize(
    "t,d,expected",
    [("Originada", None, "voz_originada"), ("Recebida", None, "voz_recebida"), ("SMS Originado", None, "sms_enviado"),
     ("SMS", "Entrante", "sms_recebido"), ("Voz", "Sainte", "voz_originada"), ("Dados", None, "dados"),
     ("GPRS", None, "dados"), ("Chamada desviada", None, "desvio"), ("XYZ", None, "outro")],
)
def test_classify_event(t, d, expected):
    assert N.classify_event(t, d)[0] == expected


def test_classify_without_type_needs_declaration():
    assert N.classify_event(None, "out")[0] == "outro"
    assert N.classify_event(None, "out", default_type="voz")[0] == "voz_originada"
    assert N.classify_event("MO", None, {"MO": "sms_enviado"})[0] == "sms_enviado"


def test_cell_keys_are_technology_specific():
    k_ci = N.build_cell_key("3G", "724", "02", "1100", None, "12345", None, None, None, None)
    k_eci = N.build_cell_key("4G", "724", "02", None, "5100", None, "12345", None, None, None)
    k_nci = N.build_cell_key("5G", "724", "02", None, "5100", None, None, "12345", None, None)
    assert len({k_ci, k_eci, k_nci}) == 3


def test_ids_hex_and_cgi():
    assert N.normalize_id("0x1F") == "31"
    assert N.normalize_id("1F", hex_mode=True) == "31"
    assert N.normalize_id("00123") == "123"
    assert N.normalize_cgi("724-02-01100-20001") == "724-02-1100-20001"
    assert N.normalize_cgi("72402011002000") == "72402011002000"  # concatenado: não é dividido por suposição
    assert N.split_cgi("724-02-768001") == {"mcc": "724", "mnc": "02", "cid": "768001"}


@pytest.mark.parametrize(
    "raw,kind,expected",
    [("-15,7801", "latitude", -15.7801), ("-47.92", "longitude", -47.92), ("15°46'48\"S", "latitude", -15.78),
     ("-15780100", "latitude", -15.7801), ("95", "latitude", None)],
)
def test_coords(raw, kind, expected):
    v, _ = N.parse_coord(raw, kind)
    assert (v is None and expected is None) or abs(v - expected) < 1e-3


def test_coords_issue():
    assert "inválida" in N.coords_issue(0, 0)
    assert "fora do território" in N.coords_issue(40.7, -74.0)
    assert N.coords_issue(-15.8, -47.9) is None


def test_operator_detection_does_not_use_number_prefix():
    r = N.detect_operator("extrato.csv", ["Linha (61) 99999-0001"], ["Data", "Hora"], [])
    assert r["operator"] is None
    r = N.detect_operator("TIM_extrato.csv", ["TIM S.A. - extrato"], [], ["02", "02"])
    assert r["operator"] == "TIM" and r["confidence"] > 0.5
