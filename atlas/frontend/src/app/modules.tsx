import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  FileSearch,
  FileStack,
  FileText,
  FolderKanban,
  GitMerge,
  Map,
  Network,
  PhoneCall,
  RadioTower,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Tone } from '../components/ui'

/** Módulos da tela inicial (cartões grandes) — `path` relativo à análise quando `inCase`. */
export type ModuleDef = { key: string; title: string; description: string; icon: ReactNode; path: string; inCase: boolean; tone: Tone }

export const MODULES: ModuleDef[] = [
  { key: 'cases', title: 'Análise Atual', description: 'Identificação, alvos, período autorizado e escopo da análise aberta nesta aba (nada é salvo).', icon: <FolderKanban />, path: '', inCase: true, tone: 'blue' },
  { key: 'import', title: 'Importação de Bilhetagem', description: 'Assistente de importação com detecção de layout, mapeamento de colunas, validação e prévia.', icon: <Upload />, path: 'arquivos', inCase: true, tone: 'blue' },
  { key: 'cdr', title: 'Análise Telefônica', description: 'Explorador de chamadas, SMS e dados com filtros combinados e consultas salvas.', icon: <PhoneCall />, path: 'eventos', inCase: true, tone: 'blue' },
  { key: 'erb', title: 'Análise de ERB', description: 'Resolução técnica de células, cadastro versionado, células por período e inconsistências.', icon: <RadioTower />, path: 'erb', inCase: true, tone: 'amber' },
  { key: 'links', title: 'Análise de Vínculos', description: 'Grafo de contatos, reciprocidade, contatos em comum e comparação entre números.', icon: <Network />, path: 'vinculos', inCase: true, tone: 'teal' },
  { key: 'timeline', title: 'Linha do Tempo', description: 'Eventos em ordem cronológica, picos, lacunas e anotações do analista.', icon: <Clock />, path: 'linha-do-tempo', inCase: true, tone: 'blue' },
  { key: 'geo', title: 'Geolocalização', description: 'Mapa de estações com setores esquemáticos, sequência de células e reprodução cronológica.', icon: <Map />, path: 'mapa', inCase: true, tone: 'amber' },
  { key: 'stats', title: 'Análise Estatística', description: 'Distribuições, picos, mudanças de frequência e anomalias com o método explicado.', icon: <BarChart3 />, path: 'estatistica', inCase: true, tone: 'violet' },
  { key: 'reports', title: 'Relatórios Técnicos', description: 'Exportação em PDF, Excel e CSV gerada no navegador, com critérios, hashes e rastreabilidade.', icon: <FileText />, path: 'relatorios', inCase: true, tone: 'blue' },
  { key: 'quality', title: 'Validação e Qualidade', description: 'Erros por linha, fusos, duplicidades, escopo e cruzamento multifonte.', icon: <ShieldCheck />, path: 'qualidade', inCase: true, tone: 'green' },
  { key: 'files', title: 'Gestão de Arquivos', description: 'Arquivos lidos direto do seu computador, com SHA-256 calculado localmente; nada é enviado.', icon: <FileStack />, path: 'arquivos', inCase: true, tone: 'gray' },
  { key: 'audit', title: 'Privacidade e Segurança', description: 'Processamento local, nenhum dado gravado, sessão individual e apagamento automático ao sair.', icon: <Activity />, path: '/configuracoes', inCase: false, tone: 'red' },
]

export type Tool = { title: string; description: string; path: string; tab?: string }
export type ToolGroup = { title: string; icon: ReactNode; tone: Tone; tools: Tool[] }

export const TOOL_GROUPS: ToolGroup[] = [
  {
    title: 'Importação e tratamento',
    icon: <Upload className="h-5 w-5" />,
    tone: 'blue',
    tools: [
      { title: 'Importador de arquivos', description: 'Leitura local de CSV, TXT, XLS, XLSX, XML, JSON, HTML, PDF (com OCR) e ZIP, com SHA-256 do original.', path: 'arquivos' },
      { title: 'Identificador de layout', description: 'Detecção de formato, codificação, separador, linha de cabeçalho e indício de operadora com nível de confiança.', path: 'arquivos' },
      { title: 'Conversor de formatos', description: 'Normalização de datas, horários, fusos, durações, números e identificadores para o modelo padronizado.', path: 'importacoes' },
      { title: 'Validador de campos', description: 'Erros e avisos por linha e campo, com prévia dos registros antes do processamento.', path: 'qualidade' },
      { title: 'Detector de duplicidades', description: 'Registros idênticos marcados e excluídos das estatísticas, com a regra explicitada.', path: 'qualidade' },
    ],
  },
  {
    title: 'Análise de bilhetagem',
    icon: <PhoneCall className="h-5 w-5" />,
    tone: 'blue',
    tools: [
      { title: 'Análise de chamadas', description: 'Chamadas originadas, recebidas, desviadas e sem duração, com filtros combinados.', path: 'eventos', tab: 'voz' },
      { title: 'Análise de SMS', description: 'Mensagens enviadas e recebidas quando identificáveis no documento.', path: 'eventos', tab: 'sms' },
      { title: 'Análise de sessões de dados', description: 'Conexões de dados com IP, volumes e células quando fornecidos.', path: 'eventos', tab: 'dados' },
      { title: 'Frequência de contatos', description: 'Interlocutores por eventos, dias distintos, reciprocidade, duração e regularidade.', path: 'contatos' },
      { title: 'Padrões de horário', description: 'Distribuição por hora e dia da semana, picos e intervalos entre eventos.', path: 'estatistica' },
      { title: 'Comparação entre períodos', description: 'Contatos novos, interrompidos, em alta ou em queda entre dois períodos.', path: 'contatos', tab: 'periodos' },
    ],
  },
  {
    title: 'Análise de vínculos',
    icon: <Network className="h-5 w-5" />,
    tone: 'teal',
    tools: [
      { title: 'Rede de contatos', description: 'Grafo interativo com expansão de nós, filtros e registros que sustentam cada conexão.', path: 'vinculos' },
      { title: 'Reciprocidade de chamadas', description: 'Conexões com comunicação nos dois sentidos destacadas no grafo e nas tabelas.', path: 'vinculos' },
      { title: 'Contatos em comum', description: 'Matriz comparativa de contatos compartilhados e exclusivos entre números.', path: 'comparar', tab: 'comum' },
      { title: 'Interseção de eventos', description: 'Coincidências temporais configuráveis, opcionalmente na mesma célula ou local de estação.', path: 'comparar', tab: 'coincidencias' },
      { title: 'Comparação de atividades', description: 'Volumes, horários, células compartilhadas e contatos diretos entre números.', path: 'comparar' },
      { title: 'Cruzamento multifonte', description: 'Correspondência de registros recíprocos entre arquivos e operadoras: exata, provável, ambígua ou ausente.', path: 'cruzamento' },
    ],
  },
  {
    title: 'Análise de ERB',
    icon: <RadioTower className="h-5 w-5" />,
    tone: 'amber',
    tools: [
      { title: 'Identificação de células', description: 'Eventos agrupados por célula, com tecnologia, operadora e resultado da resolução.', path: 'erb' },
      { title: 'Cruzamento com cadastro técnico', description: 'Resolução por regras versionadas, ambiguidades listadas e revisão manual registrada no relatório.', path: 'erb', tab: 'resolucao' },
      { title: 'Cadastro de células', description: 'Tabela pesquisável do cadastro técnico por versão, com situação de validação.', path: 'erb/cadastro' },
      { title: 'Comparação temporal de células', description: 'Células usadas em cada período e células observadas para múltiplos números.', path: 'erb', tab: 'periodos' },
      { title: 'Consistência de coordenadas', description: 'Coordenadas inválidas, conflitantes ou divergentes entre versões do cadastro.', path: 'erb', tab: 'inconsistencias' },
    ],
  },
  {
    title: 'Análise temporal e geográfica',
    icon: <Map className="h-5 w-5" />,
    tone: 'amber',
    tools: [
      { title: 'Linha do tempo', description: 'Eventos combinados com anotações, zoom por dia ou hora e destaque de picos.', path: 'linha-do-tempo' },
      { title: 'Mapa de eventos', description: 'Estações com coordenadas do cadastro, setores esquemáticos e painel de detalhes.', path: 'mapa' },
      { title: 'Sequência de células', description: 'Ordem dos registros de rede de um número, intervalos e trocas de célula.', path: 'mapa', tab: 'sequencia' },
      { title: 'Detecção de lacunas', description: 'Períodos sem registros e intervalos incomuns entre eventos.', path: 'estatistica' },
      { title: 'Reprodução cronológica', description: 'Avanço, recuo e pausa sobre a sequência documental de registros.', path: 'mapa', tab: 'reproducao' },
    ],
  },
  {
    title: 'Saídas, alertas e assistência',
    icon: <FileSearch className="h-5 w-5" />,
    tone: 'violet',
    tools: [
      { title: 'Central de alertas', description: 'Regras configuráveis com registros de suporte, relevância e revisão do analista.', path: 'alertas' },
      { title: 'Gerador de relatórios', description: 'Relatórios de bilhetagem, ERB e vínculos em PDF, Excel ou CSV, com rastreabilidade completa.', path: 'relatorios' },
      { title: 'Assistente analítico local', description: 'Perguntas em português convertidas em consultas verificáveis, executadas no seu navegador.', path: 'assistente' },
    ],
  },
]

export const ICONS = { AlertTriangle, GitMerge, Sparkles }
