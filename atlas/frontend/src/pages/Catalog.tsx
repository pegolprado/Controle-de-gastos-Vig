import { Wrench } from 'lucide-react'
import { apath } from '../app/layout'
import { TOOL_GROUPS } from '../app/modules'
import { ModuleCard, Notice, PageHeader, SectionHeader } from '../components/ui'

export default function Catalog() {
  const total = TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0)
  return (
    <div>
      <PageHeader
        icon={<Wrench className="h-5 w-5" />}
        title="Catálogo de ferramentas"
        subtitle="Ferramentas de importação, bilhetagem, vínculos, ERB e análise temporal/geográfica, organizadas por categoria. Cada ferramenta abre a tela funcional da análise atual."
        badge={<span className="chip border-accent/40 bg-accent/10 text-accent">● Portal ativo · {total} ferramentas disponíveis</span>}
      />
      <Notice tone="teal">As ferramentas trabalham sobre os arquivos carregados nesta aba. Nada é gravado: ao sair, a análise é apagada.</Notice>
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
                  to={`${apath(t.path)}${t.tab ? `?aba=${t.tab}` : ''}`}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
