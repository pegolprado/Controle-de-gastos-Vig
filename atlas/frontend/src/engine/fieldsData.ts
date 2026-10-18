// Gerado a partir do catálogo validado no back-end anterior (mesmos sinônimos).
export type FieldSpec = { label: string; syn: string[] }
export const CDR_FIELDS: Record<string, FieldSpec> = {
 "target_number": {
  "label": "Número alvo",
  "syn": [
   "numero alvo",
   "linha alvo",
   "msisdn alvo",
   "terminal alvo",
   "numero monitorado",
   "alvo",
   "linha",
   "terminal",
   "msisdn"
  ]
 },
 "a_number": {
  "label": "Número de origem (A)",
  "syn": [
   "a party",
   "aparty",
   "numero a",
   "num a",
   "origem",
   "chamador",
   "originador",
   "numero origem",
   "numero de origem",
   "calling",
   "calling number",
   "msisdn a",
   "telefone origem",
   "nr origem",
   "numero chamador",
   "assinante a"
  ]
 },
 "b_number": {
  "label": "Número de destino (B)",
  "syn": [
   "b party",
   "bparty",
   "numero b",
   "num b",
   "destino",
   "chamado",
   "numero destino",
   "numero de destino",
   "called",
   "called number",
   "msisdn b",
   "telefone destino",
   "nr destino",
   "numero chamado",
   "assinante b"
  ]
 },
 "other_number": {
  "label": "Interlocutor",
  "syn": [
   "interlocutor",
   "numero interlocutor",
   "outro numero",
   "contraparte",
   "numero contato",
   "contato"
  ]
 },
 "direction": {
  "label": "Sentido (originada/recebida)",
  "syn": [
   "sentido",
   "direcao",
   "direcao chamada",
   "entrada saida",
   "mo mt",
   "origem destino",
   "fluxo"
  ]
 },
 "event_type": {
  "label": "Tipo de evento",
  "syn": [
   "tipo",
   "tipo evento",
   "tipo de evento",
   "servico",
   "tipo servico",
   "tipo de servico",
   "evento",
   "tipo chamada",
   "tipo de chamada",
   "tipo registro",
   "call type",
   "event type",
   "service"
  ]
 },
 "datetime": {
  "label": "Data e hora (mesmo campo)",
  "syn": [
   "data hora",
   "datahora",
   "data e hora",
   "timestamp",
   "data hora inicio",
   "inicio",
   "data hora evento",
   "data hora chamada",
   "start time",
   "datetime",
   "date time",
   "data hora conexao",
   "inicio conexao"
  ]
 },
 "date": {
  "label": "Data do evento",
  "syn": [
   "data",
   "date",
   "data evento",
   "data do evento",
   "data chamada",
   "data da chamada",
   "dt",
   "dt evento",
   "data inicio",
   "data conexao"
  ]
 },
 "time": {
  "label": "Horário do evento",
  "syn": [
   "hora",
   "time",
   "hora evento",
   "horario",
   "hora inicio",
   "hora chamada",
   "hr",
   "hora da chamada",
   "hora conexao"
  ]
 },
 "timezone": {
  "label": "Fuso informado",
  "syn": [
   "fuso",
   "fuso horario",
   "timezone",
   "utc offset",
   "gmt"
  ]
 },
 "duration": {
  "label": "Duração",
  "syn": [
   "duracao",
   "duration",
   "segundos",
   "tempo",
   "dur",
   "duracao s",
   "duracao seg",
   "duracao segundos",
   "tempo conversacao",
   "duracao chamada",
   "tempo de conexao",
   "duracao conexao"
  ]
 },
 "status": {
  "label": "Status do evento",
  "syn": [
   "status",
   "resultado",
   "situacao",
   "causa",
   "causa desconexao",
   "status chamada"
  ]
 },
 "tech": {
  "label": "Tecnologia de acesso",
  "syn": [
   "tecnologia",
   "rat",
   "tech",
   "tipo rede",
   "rede",
   "tecnologia acesso"
  ]
 },
 "mcc": {
  "label": "MCC",
  "syn": [
   "mcc"
  ]
 },
 "mnc": {
  "label": "MNC",
  "syn": [
   "mnc"
  ]
 },
 "lac": {
  "label": "LAC",
  "syn": [
   "lac",
   "location area",
   "lac inicial",
   "lac origem"
  ]
 },
 "tac": {
  "label": "TAC",
  "syn": [
   "tac",
   "tracking area",
   "tac inicial"
  ]
 },
 "cell_id": {
  "label": "Cell ID / CI",
  "syn": [
   "cell id",
   "cellid",
   "ci",
   "cell",
   "celula",
   "id celula",
   "cell id inicial",
   "ci inicial",
   "ci origem",
   "sac"
  ]
 },
 "eci": {
  "label": "ECI (LTE)",
  "syn": [
   "eci",
   "e utran cell id",
   "eutran cell id",
   "eutran ci",
   "lte cell id"
  ]
 },
 "nci": {
  "label": "NCI (5G NR)",
  "syn": [
   "nci",
   "nr cell id",
   "nr ci",
   "nrci"
  ]
 },
 "cgi": {
  "label": "CGI / ECGI / NCGI",
  "syn": [
   "cgi",
   "ecgi",
   "ncgi",
   "nrcgi",
   "cgi ecgi",
   "id erb",
   "cgi erb",
   "cgi inicial",
   "cgi origem",
   "cgi celula"
  ]
 },
 "erb_raw": {
  "label": "ERB (código/nome informado)",
  "syn": [
   "erb",
   "estacao",
   "site",
   "erb origem",
   "erb inicial",
   "station",
   "codigo erb",
   "nome erb",
   "estacao radio base",
   "erb a"
  ]
 },
 "lat": {
  "label": "Latitude",
  "syn": [
   "latitude",
   "lat",
   "lat erb",
   "latitude erb"
  ]
 },
 "lon": {
  "label": "Longitude",
  "syn": [
   "longitude",
   "lon",
   "long",
   "lng",
   "lon erb",
   "longitude erb"
  ]
 },
 "azimuth": {
  "label": "Azimute",
  "syn": [
   "azimute",
   "azimuth",
   "direcao do setor",
   "azim",
   "az",
   "azimute erb"
  ]
 },
 "imei": {
  "label": "IMEI",
  "syn": [
   "imei",
   "imei a",
   "imei alvo",
   "imei origem"
  ]
 },
 "imsi": {
  "label": "IMSI",
  "syn": [
   "imsi",
   "imsi a",
   "imsi alvo"
  ]
 },
 "ip": {
  "label": "Endereço IP",
  "syn": [
   "ip",
   "endereco ip",
   "ip origem",
   "ip address",
   "ip publico",
   "ipv4",
   "ipv6"
  ]
 },
 "bytes_up": {
  "label": "Volume enviado (bytes)",
  "syn": [
   "upload",
   "bytes up",
   "volume up",
   "bytes enviados",
   "uplink",
   "volume uplink",
   "trafego up"
  ]
 },
 "bytes_down": {
  "label": "Volume recebido (bytes)",
  "syn": [
   "download",
   "bytes down",
   "volume down",
   "bytes recebidos",
   "downlink",
   "volume downlink",
   "trafego down"
  ]
 }
}
export const ERB_FIELDS: Record<string, FieldSpec> = {
 "operator": {
  "label": "Operadora",
  "syn": [
   "operadora",
   "operator",
   "prestadora",
   "empresa"
  ]
 },
 "tech": {
  "label": "Tecnologia de acesso",
  "syn": [
   "tecnologia",
   "rat",
   "tech",
   "tipo rede",
   "rede",
   "tecnologia acesso"
  ]
 },
 "mcc": {
  "label": "MCC",
  "syn": [
   "mcc"
  ]
 },
 "mnc": {
  "label": "MNC",
  "syn": [
   "mnc"
  ]
 },
 "lac": {
  "label": "LAC",
  "syn": [
   "lac",
   "location area",
   "lac inicial",
   "lac origem"
  ]
 },
 "tac": {
  "label": "TAC",
  "syn": [
   "tac",
   "tracking area",
   "tac inicial"
  ]
 },
 "cell_id": {
  "label": "Cell ID / CI",
  "syn": [
   "cell id",
   "cellid",
   "ci",
   "cell",
   "celula",
   "id celula",
   "cell id inicial",
   "ci inicial",
   "ci origem",
   "sac"
  ]
 },
 "eci": {
  "label": "ECI (LTE)",
  "syn": [
   "eci",
   "e utran cell id",
   "eutran cell id",
   "eutran ci",
   "lte cell id"
  ]
 },
 "nci": {
  "label": "NCI (5G NR)",
  "syn": [
   "nci",
   "nr cell id",
   "nr ci",
   "nrci"
  ]
 },
 "cgi": {
  "label": "CGI / ECGI / NCGI",
  "syn": [
   "cgi",
   "ecgi",
   "ncgi",
   "nrcgi",
   "cgi ecgi",
   "cgi celula"
  ]
 },
 "site_code": {
  "label": "Código da estação",
  "syn": [
   "codigo",
   "codigo estacao",
   "site",
   "site id",
   "id site",
   "sigla",
   "estacao",
   "erb",
   "codigo erb",
   "end id",
   "enodeb",
   "station id"
  ]
 },
 "site_name": {
  "label": "Nome da estação",
  "syn": [
   "nome",
   "nome erb",
   "nome site",
   "nome estacao",
   "descricao",
   "site name"
  ]
 },
 "address": {
  "label": "Endereço",
  "syn": [
   "endereco",
   "logradouro",
   "address",
   "endereco erb",
   "municipio",
   "cidade"
  ]
 },
 "lat": {
  "label": "Latitude",
  "syn": [
   "latitude",
   "lat",
   "lat erb",
   "latitude erb"
  ]
 },
 "lon": {
  "label": "Longitude",
  "syn": [
   "longitude",
   "lon",
   "long",
   "lng",
   "lon erb",
   "longitude erb"
  ]
 },
 "azimuth": {
  "label": "Azimute",
  "syn": [
   "azimute",
   "azimuth",
   "direcao do setor",
   "azim",
   "az",
   "azimute erb"
  ]
 },
 "beamwidth": {
  "label": "Abertura do setor (graus)",
  "syn": [
   "abertura",
   "beamwidth",
   "largura feixe",
   "largura do feixe",
   "hbw",
   "abertura horizontal"
  ]
 },
 "sector": {
  "label": "Setor",
  "syn": [
   "setor",
   "sector",
   "face"
  ]
 },
 "height_m": {
  "label": "Altura (m)",
  "syn": [
   "altura",
   "height",
   "altura antena",
   "altura m"
  ]
 }
}
