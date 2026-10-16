import type { AccountType, PaymentMethod, RecurrenceFreq, TxKind, TxStatus, WorkspaceRole, InvoiceStatus } from '@/lib/types';

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Dinheiro',
  payment: 'Conta de pagamento',
  investment: 'Investimentos',
  other: 'Outra',
};

export const TX_KIND_LABEL: Record<TxKind, string> = {
  income: 'Receita',
  expense: 'Despesa',
  transfer: 'Transferência',
  card_payment: 'Pagamento de fatura',
};

export const TX_STATUS_LABEL: Record<TxStatus, string> = {
  planned: 'Previsto',
  pending: 'Pendente',
  paid: 'Pago',
  received: 'Recebido',
  cancelled: 'Cancelado',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  debit: 'Débito',
  credit_card: 'Cartão de crédito',
  cash: 'Dinheiro',
  boleto: 'Boleto',
  transfer: 'Transferência',
  auto_debit: 'Débito automático',
  other: 'Outro',
};

export const FREQ_LABEL: Record<RecurrenceFreq, string> = {
  daily: 'Diária',
  weekly: 'Semanal',
  monthly: 'Mensal',
  yearly: 'Anual',
};

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  editor: 'Editor financeiro',
  contributor: 'Colaborador',
  viewer: 'Somente leitura',
};

export const ROLE_DESCRIPTION: Record<WorkspaceRole, string> = {
  owner: 'Controle total, inclusive excluir o espaço.',
  admin: 'Gerencia membros, convites e todos os dados.',
  editor: 'Cria e edita qualquer lançamento, contas, cartões e orçamentos.',
  contributor: 'Cria lançamentos e edita apenas os próprios.',
  viewer: 'Apenas visualiza dados e relatórios.',
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  partial: 'Paga parcialmente',
  paid: 'Paga',
  overdue: 'Vencida',
};

export const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 5, admin: 4, editor: 3, contributor: 2, viewer: 1 };

export function can(role: WorkspaceRole | undefined, action: 'read' | 'contribute' | 'edit' | 'admin' | 'own'): boolean {
  if (!role) return false;
  const need = { read: 1, contribute: 2, edit: 3, admin: 4, own: 5 }[action];
  return ROLE_RANK[role] >= need;
}
