import { useMutation } from '@tanstack/react-query'
import { Send, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { answer } from '../../engine/assistant'
import { useCase } from '../../app/layout'
import { Badge, DrillLink, ErrorBox, Loading, Notice, PageHeader } from '../../components/ui'

const KIND: Record<string, [string, any]> = {
  dado: ['dado extraído', 'blue'],
  calculo: ['cálculo estatístico', 'violet'],
  correlacao: ['correlação temporal', 'teal'],
  hipotese: ['hipótese analítica', 'amber'],
  indisponivel: ['informação não disponível', 'gray'],
  limite: ['limite dos dados', 'amber'],
  validacao: ['depende de validação humana', 'red'],
}

const EXAMPLES = [
  'Quantas chamadas o alvo A fez entre 01/03/2026 e 15/03/2026?',
  'Quais os contatos mais frequentes do alvo B à noite?',
  'Contatos em comum entre os alvos A e B',
  'Os alvos A e C tiveram registros na mesma ERB?',
  'Resumo de SMS de madrugada',
]

export default function Assistant() {
  const { c, meta } = useCase()
  const [q, setQ] = useState('')
  const [history, setHistory] = useState<{ q: string; r: any }[]>([])
  const m = useMutation({
    mutationFn: (question: string) => answer(question, (meta?.targets ?? []).map((t: any) => t.number)) as Promise<any>,
    onSuccess: (r, question) => setHistory((h) => [{ q: question, r }, ...h]),
  })
  return (
    <div>
      <PageHeader
        icon={<Sparkles className="h-5 w-5" />}
        title="Assistente analítico"
        subtitle="Converte perguntas em português em consultas estruturadas e verificáveis e descreve os resultados calculados. Funciona inteiramente no servidor da plataforma: nenhum dado é enviado a serviços externos."
      />
      <Notice>
        O assistente não inventa registros nem completa dados ausentes. Cada resposta separa <b>dado extraído</b>, <b>cálculo</b>, <b>correlação</b>, <b>hipótese</b> e o que depende de <b>validação humana</b>, e permite abrir os registros. A integração com modelos de linguagem externos está desativada e exigiria avaliação de segurança e autorização institucional.
      </Notice>
      <form
        className="card my-4 flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim().length >= 3) m.mutate(q)
        }}
      >
        <input className="flex-1" placeholder="Pergunte sobre os registros desta análise…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" disabled={m.isPending}>
          <Send className="h-4 w-4" /> Perguntar
        </button>
      </form>
      <div className="mb-6 flex flex-wrap gap-2">
        {EXAMPLES.map((x) => (
          <button key={x} className="chip border-line !py-1.5 text-muted hover:text-text" onClick={() => (setQ(x), m.mutate(x))}>
            {x}
          </button>
        ))}
      </div>
      {m.isPending && <Loading label="Consultando…" />}
      {m.error && <ErrorBox error={m.error} />}
      <div className="space-y-4">
        {history.map(({ q: question, r }, i) => (
          <div key={i} className="card p-5">
            <div className="mb-3 text-sm text-muted">
              Pergunta: <span className="text-text">{question}</span>
            </div>
            <div className="mb-3 rounded-lg border border-line bg-ink-2 p-3 text-xs">
              <div className="label">Interpretação ({r.intent})</div>
              <ul className="list-inside list-disc text-muted">
                {r.interpretation.map((x: string) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <div className="mt-1 font-mono text-faint">filtro: {JSON.stringify(r.filter)}</div>
            </div>
            <ul className="space-y-2">
              {r.answer.map((a: any, j: number) => (
                <li key={j} className="flex items-start gap-2 text-sm">
                  <Badge tone={KIND[a.kind]?.[1] ?? 'gray'} className="mt-0.5 shrink-0">
                    {KIND[a.kind]?.[0] ?? a.kind}
                  </Badge>
                  <span>{a.text}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between">
              <DrillLink caseId={c.id} filter={r.filter} className="btn-ghost !py-1 text-xs">
                Abrir registros correspondentes
              </DrillLink>
              <span className="text-[11px] text-faint">{r.engine}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
