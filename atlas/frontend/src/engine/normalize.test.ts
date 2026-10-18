import * as N from './normalize'

describe('números', () => {
  it.each([
    ['(61) 99999-0001', '+5561999990001'],
    ['61999990001', '+5561999990001'],
    ['+55 61 99999-0001', '+5561999990001'],
    ['5561999990001', '+5561999990001'],
    ['061999990001', '+5561999990001'],
    ['01561999990001', '+5561999990001'],
    ['0016505551234', '+16505551234'],
    ['61999990001.0', '+5561999990001'],
    ['190', '190'],
    ['', null],
  ])('%s', (raw, exp) => expect(N.normalizeNumber(raw)[0]).toBe(exp))
  it('não acrescenta o nono dígito', () => {
    const [n, w] = N.normalizeNumber('6188880001')
    expect(n).toBe('+556188880001')
    expect(w.join()).toContain('nono dígito')
  })
})

describe('durações', () => {
  it.each([
    ['00:01:30', 's', 90], ['1:02:03', 's', 3723], ['02:05', 's', 125], ['45', 's', 45], ['1,5', 'min', 90],
    ['1500', 'ms', 2], ['2m 5s', 's', 125], ['1899-12-30 00:01:23', 's', 83], ['', 's', null],
  ])('%s', (raw, unit, exp) => expect(N.parseDuration(raw as string, unit as string)[0]).toBe(exp))
  it('inválida', () => expect(N.parseDuration('abc')[1]).toBeTruthy())
})

describe('datas e fusos', () => {
  it('formatos e offsets', () => {
    let [d, off, err] = N.parseLocalDatetime('05/03/2026', '14:30:00', null)
    expect(N.localIso(d!)).toBe('2026-03-05T14:30:00')
    expect(off).toBeNull()
    expect(err).toBeNull()
    ;[d, off] = N.parseLocalDatetime(null, null, '2026-03-05T14:30:00-03:00')
    expect(off).toBe('-03:00')
    expect(new Date(N.toUtcMs(d!, off, null)).toISOString()).toBe('2026-03-05T17:30:00.000Z')
    ;[d] = N.parseLocalDatetime(null, null, '20260305 143000')
    expect(N.localIso(d!)).toBe('2026-03-05T14:30:00')
    ;[d, , err] = N.parseLocalDatetime('31/02/2026', '10:00', null)
    expect(d).toBeNull()
    expect(err).toContain('não reconhecida')
    ;[d, , err] = N.parseLocalDatetime('05/03/2026', null, null)
    expect(err).toContain('sem horário')
    ;[d] = N.parseLocalDatetime(null, null, '46086.5', null, null, 'excel_serial')
    expect(d!.y).toBe(2026)
    expect(d!.h).toBe(12)
  })
  it('ambiguidade dia/mês', () => {
    expect(N.detectFormat(['01/02/2026', '03/04/2026'], N.DATE_FORMATS)).toEqual({ format: '%d/%m/%Y', rate: 1, ambiguous: true })
    expect(N.detectFormat(['25/02/2026', '03/04/2026'], N.DATE_FORMATS).ambiguous).toBe(false)
  })
  it('horário de verão histórico de São Paulo', () => {
    const l = (y: number, mo: number, d: number, h: number) => ({ y, mo, d, h, mi: 0, s: 0, ms: 0 })
    expect(new Date(N.toUtcMs(l(2018, 12, 1, 12), null, 'America/Sao_Paulo')).getUTCHours()).toBe(14)
    expect(new Date(N.toUtcMs(l(2026, 3, 1, 12), null, 'America/Sao_Paulo')).getUTCHours()).toBe(15)
  })
})

describe('tipos de evento', () => {
  it.each([
    ['Originada', null, 'voz_originada'], ['Recebida', null, 'voz_recebida'], ['SMS Originado', null, 'sms_enviado'],
    ['SMS', 'Entrante', 'sms_recebido'], ['Voz', 'Sainte', 'voz_originada'], ['Dados', null, 'dados'], ['GPRS', null, 'dados'],
    ['Chamada desviada', null, 'desvio'], ['XYZ', null, 'outro'],
  ])('%s', (t, d, exp) => expect(N.classifyEvent(t, d)[0]).toBe(exp))
  it('sem tipo exige declaração', () => {
    expect(N.classifyEvent(null, 'out')[0]).toBe('outro')
    expect(N.classifyEvent(null, 'out', {}, 'voz')[0]).toBe('voz_originada')
    expect(N.classifyEvent('MO', null, { MO: 'sms_enviado' })[0]).toBe('sms_enviado')
  })
})

describe('células e coordenadas', () => {
  it('chaves específicas por tecnologia', () => {
    const k1 = N.buildCellKey('3G', '724', '02', '1100', null, '12345', null, null, null, null)
    const k2 = N.buildCellKey('4G', '724', '02', null, '5100', null, '12345', null, null, null)
    const k3 = N.buildCellKey('5G', '724', '02', null, '5100', null, null, '12345', null, null)
    expect(new Set([k1, k2, k3]).size).toBe(3)
  })
  it('identificadores e CGI', () => {
    expect(N.normalizeId('0x1F')).toBe('31')
    expect(N.normalizeId('1F', true)).toBe('31')
    expect(N.normalizeId('00123')).toBe('123')
    expect(N.normalizeCgi('724-02-01100-20001')).toBe('724-02-1100-20001')
    expect(N.normalizeCgi('72402011002000')).toBe('72402011002000')
    expect(N.splitCgi('724-02-768001')).toEqual({ mcc: '724', mnc: '02', cid: '768001' })
  })
  it.each([
    ['-15,7801', 'latitude', -15.7801], ['-47.92', 'longitude', -47.92], ['15°46\'48"S', 'latitude', -15.78],
    ['-15780100', 'latitude', -15.7801], ['95', 'latitude', null],
  ])('coordenada %s', (raw, kind, exp) => {
    const [v] = N.parseCoord(raw as string, kind as any)
    if (exp === null) expect(v).toBeNull()
    else expect(Math.abs(v! - (exp as number))).toBeLessThan(1e-3)
  })
  it('problemas de coordenada', () => {
    expect(N.coordsIssue(0, 0)).toContain('inválida')
    expect(N.coordsIssue(40.7, -74)).toContain('fora do território')
    expect(N.coordsIssue(-15.8, -47.9)).toBeNull()
  })
  it('operadora não é deduzida pelo prefixo', () => {
    expect(N.detectOperator('extrato.csv', ['Linha (61) 99999-0001'], ['Data'], []).operator).toBeNull()
    const r = N.detectOperator('TIM_extrato.csv', ['TIM S.A. - extrato'], [], ['02', '02'])
    expect(r.operator).toBe('TIM')
    expect(r.confidence).toBeGreaterThan(0.5)
  })
})
