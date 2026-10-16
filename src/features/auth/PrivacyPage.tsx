import { Link } from 'react-router-dom';
import { useBrand } from '@/app/BrandProvider';

export default function PrivacyPage() {
  const brand = useBrand();
  return (
    <div className="mx-auto max-w-2xl px-5 py-12 text-[15px] leading-relaxed">
      <Link to="/" className="text-sm font-semibold text-brand">
        ← Voltar
      </Link>
      <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight">Política de Privacidade</h1>
      <div className="mt-6 space-y-4 text-muted [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-fg">
        <p>Esta política descreve como o {brand.app_name} trata dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018).</p>
        <h2>Quais dados tratamos</h2>
        <p>Nome, e-mail, os lançamentos financeiros que você registra manualmente (descrições, valores, datas, categorias, contas e cartões cadastrados) e comprovantes que você anexar. Não solicitamos nem armazenamos senhas bancárias.</p>
        <h2>Finalidade e base legal</h2>
        <p>Os dados são usados exclusivamente para prestar o serviço de controle financeiro (execução de contrato, art. 7º, V). Não vendemos nem compartilhamos dados com terceiros para publicidade.</p>
        <h2>Quem acessa</h2>
        <p>Somente você e as pessoas que você convidar para um espaço compartilhado, conforme as permissões atribuídas. O administrador do aplicativo não tem acesso aos seus dados financeiros, exceto se você conceder acesso temporário de suporte, que é registrado e expira automaticamente.</p>
        <h2>Segurança</h2>
        <p>Conexões via HTTPS, senhas armazenadas com hash pelo provedor de autenticação, controle de acesso por linha no banco de dados (RLS) e backups periódicos.</p>
        <h2>Retenção e exclusão</h2>
        <p>Você pode exportar todos os seus dados e excluir sua conta a qualquer momento em Ajustes. Registros técnicos (erros) são mantidos por 90 dias; o histórico de auditoria financeira por até 5 anos, ou até a exclusão do espaço.</p>
        <h2>Seus direitos</h2>
        <p>Confirmação, acesso, correção, portabilidade, anonimização e eliminação dos dados. Para exercê-los, use as opções em Ajustes ou contate o administrador do aplicativo.</p>
      </div>
    </div>
  );
}
