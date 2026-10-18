import { decodeFilter, encodeFilter, fmtDateTime, fmtDuration, fmtNumber, fmtNumberPlain, setNumberMask } from './format'

describe('formatação', () => {
  it('formata números brasileiros', () => {
    expect(fmtNumber('+5561999990001')).toBe('(61) 99999-0001')
    expect(fmtNumber('+556133330001')).toBe('(61) 3333-0001')
    expect(fmtNumber('190')).toBe('190')
    expect(fmtNumber(null)).toBe('—')
  })
  it('oculta números na tela sem afetar a exportação', () => {
    setNumberMask(true)
    try {
      expect(fmtNumber('+5561999990032')).toBe('(61) 9••••-••32')
      expect(fmtNumber('+12025550143')).toBe('+120••••••43')
      expect(fmtNumber('190')).toBe('190')
      expect(fmtNumberPlain('+5561999990032')).toBe('(61) 99999-0032')
    } finally {
      setNumberMask(false)
    }
  })
  it('formata data/hora sem converter fuso', () => {
    expect(fmtDateTime('2026-03-05T14:30:07')).toBe('05/03/2026 14:30:07')
    expect(fmtDateTime('2026-03-05')).toBe('05/03/2026')
  })
  it('formata duração', () => {
    expect(fmtDuration(3723)).toBe('01:02:03')
    expect(fmtDuration(null)).toBe('—')
  })
  it('codifica filtros com acentos na URL', () => {
    const f = { numbers: ['+5561999990001'], note: 'ação' }
    expect(decodeFilter(encodeFilter(f))).toEqual(f)
    expect(decodeFilter('lixo%%')).toBeNull()
  })
})
