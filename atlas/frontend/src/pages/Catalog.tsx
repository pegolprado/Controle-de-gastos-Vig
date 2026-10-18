import { useQuery } from '@tanstack/react-query'
import { Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { TOOL_GROUPS } from '../app/modules'
import { ModuleCard, Notice, PageHeader, SectionHeader } from '../components/ui'

type CaseLite = { id: number; code: string; title: string }
const KEY = 'atlas.currentCase'

/** Caso em foco (lembrado por usuário/navegador; não é estado sensível). */
export function useCurrentCase(): [CaseLite | null, (c: CaseLite | null) => void] {
  const [c, setC] = useState<CaseLite | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null')
    } catch {
      return null
    }
  })
  const set = (v: CaseLite | null) => {
    setC(v)
    try {
      if (v) localStorage.setItem(KEY, JSON.stringify(v))
      else localStorage.removeItem(KEY)
    } catch {
      /* armazenamento indisponível */
    }
  }
  return [c, set]
}

export default function Catalog() {
  const cases = useQuery({ queryKey: ['cases'], queryFn: () => api<any[]>('/cases') })
  const [current, setCurrent] = useCurrentCase()
  useEffect(() => {
    if (cases.data && current && !cases.data.some((c) => c.id === current.id)) setCurrent(null)
  }, [cases.data, current, setCurrent])
  const total = TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0)
  return (
    <div>
      <PageHeader
        icon={<Wrench className="h-5 w-5" />}
        title="Catálogo de ferramentas"
        subtitle="Ferramentas de importação, bilhetagem, vínculos, ERB e análise temporal/geográfica, organizadas por categoria. Cada ferramenta abre a tela funcional dentro do caso selecionado."
        badge={<span className="chip border-accent/40 bg-accent/10 text-accent">● Portal ativo · {total} ferramentas disponíveis</span>}
      />
      <div className="card mb-8 flex flex-wrap items-center gap-3 p-4">
        <span className="label !mb-0">Caso em foco</span>
        <select
          className="min-w-72 flex-1"
          value={current?.id ?? ''}
          onChange={(e) => {
            const c = cases.data?.find((x) => x.id === +e.target.value)
            setCurrent(c ? { id: c.id, code: c.code, title: c.title } : null)
          }}
        >
          <option value="">Selecione um caso…</option>
          {(cases.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title}
            </option>
          ))}
        </select>
      </div>
      {!current && <Notice tone="amber">Selecione um caso acima para abrir as ferramentas. Os dados de casos diferentes nunca são misturados.</Notice>}
      <div className="mt-6 space-y-10">
        {TOOL_GROUPS.map((g) => (
          <section key={g.title}>
            <SectionHeader icon={g.icon} title={g.title} tone={g.tone} count={g.tools.length} unit="ferramenta" />
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {g.tools.map((t) => (
                <ModuleCard
                  key={t.title}
                  title={t.title}
                  description={t.description}
                  tone={g.tone}
                  disabled={!current}
                  to={current ? `/casos/${current.id}/${t.path}${t.tab ? `?aba=${t.tab}` : ''}` : '#'}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
