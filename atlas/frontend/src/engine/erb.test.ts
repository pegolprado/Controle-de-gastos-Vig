import { buildIndex, type Cell, resolveSignature, type Sig, type Version } from './erb'

const V: Map<number, Version> = new Map([
  [1, { id: 1, reference_date: '2025-12-01' }],
  [2, { id: 2, reference_date: '2026-03-01' }],
])

function cell(id: number, kw: Partial<Cell>): Cell {
  return { id, version_id: 2, operator: 'TIM', tech: null, mcc: '724', mnc: '02', lac: null, tac: null, cell_id: null, eci: null, nci: null, cgi: null, site_code: null, site_name: null, sector: null, lat: -15.8, lon: -47.9, ...kw }
}
function sig(kw: Partial<Sig>): Sig {
  return { operator: 'TIM', tech: null, mcc: null, mnc: null, lac: null, tac: null, cell_id: null, eci: null, nci: null, cgi: null, erb_raw: null, ...kw }
}

const IDX = buildIndex([
  cell(1, { tech: '3G', lac: '1100', cell_id: '20001' }),
  cell(2, { tech: '4G', tac: '5100', eci: '20001' }),
  cell(3, { tech: '3G', lac: '1105', cell_id: '30000', lat: -15.7 }),
  cell(4, { tech: '3G', lac: '1106', cell_id: '30000', lat: -15.6 }),
  cell(5, { tech: '3G', lac: '1100', cell_id: '40000', site_code: 'SITE-A', operator: 'VIVO', mnc: '11' }),
  cell(6, { tech: '3G', lac: '1100', cell_id: '50000', site_code: 'SITE-B', sector: '1' }),
  cell(7, { tech: '3G', lac: '1100', cell_id: '50001', site_code: 'SITE-B', sector: '2' }),
  cell(8, { tech: '3G', lac: '1100', cell_id: '60000', version_id: 1, lat: -15.8 }),
  cell(9, { tech: '3G', lac: '1100', cell_id: '60000', version_id: 2, lat: -15.85 }),
])

describe('resolução de ERB', () => {
  it('exata pelo identificador completo', () => {
    const r = resolveSignature(sig({ tech: '3G', mcc: '724', mnc: '02', lac: '1100', cell_id: '20001' }), IDX, V)
    expect([r.status, r.cell?.id, r.rule]).toEqual(['exact', 1, 'id_completo'])
  })
  it('CI nunca casa com ECI', () => {
    expect(resolveSignature(sig({ tech: '4G', mcc: '724', mnc: '02', tac: '5100', eci: '20001' }), IDX, V).cell?.id).toBe(2)
    const r = resolveSignature(sig({ tech: '3G', mcc: '724', mnc: '02', lac: '9999', cell_id: '20001' }), IDX, V)
    expect(r.status).not.toBe('exact')
    expect(r.candidates).not.toContain(2)
  })
  it('CGI exato', () => {
    const r = resolveSignature(sig({ cgi: '724-02-1100-20001' }), IDX, V)
    expect([r.status, r.cell?.id, r.rule]).toEqual(['exact', 1, 'cgi_exato'])
  })
  it('provável e ambígua', () => {
    expect(resolveSignature(sig({ cell_id: '20001' }), IDX, V)).toMatchObject({ status: 'probable', cell: { id: 1 } })
    const r = resolveSignature(sig({ cell_id: '30000' }), IDX, V)
    expect(r.status).toBe('ambiguous')
    expect(new Set(r.candidates)).toEqual(new Set([3, 4]))
    expect(r.cell).toBeNull()
  })
  it('regras de operadora × MCC/MNC', () => {
    expect(resolveSignature(sig({ operator: 'TIM', cell_id: '40000' }), IDX, V).status).toBe('none')
    const r = resolveSignature(sig({ operator: 'TIM', tech: '3G', mcc: '724', mnc: '11', lac: '1100', cell_id: '40000' }), IDX, V)
    expect(r.status).toBe('exact')
    expect(r.note).toContain('outra rede')
    expect(resolveSignature(sig({ operator: 'TIM', tech: '3G', mcc: '724', mnc: '05', lac: '1100', cell_id: '40000' }), IDX, V).status).not.toBe('exact')
  })
  it('estação com setores no mesmo local', () => {
    const r = resolveSignature(sig({ erb_raw: 'site-b' }), IDX, V)
    expect(r.status).toBe('probable')
    expect(r.note).toContain('nível da estação')
  })
  it('versão mais recente e divergência', () => {
    const r = resolveSignature(sig({ tech: '3G', mcc: '724', mnc: '02', lac: '1100', cell_id: '60000' }), IDX, V)
    expect(r.cell?.id).toBe(9)
    expect(r.note).toContain('divergentes entre versões')
  })
  it('não resolvida', () => {
    const r = resolveSignature(sig({ cell_id: '99999' }), IDX, V)
    expect(r.status).toBe('none')
    expect(r.note).toContain('99999')
  })
})
