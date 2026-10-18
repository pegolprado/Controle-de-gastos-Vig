import type { ISODate } from './dates';

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'contributor' | 'viewer';
export type UserStatus = 'active' | 'pending' | 'suspended' | 'revoked';
export type AccountType = 'checking' | 'savings' | 'cash' | 'payment' | 'investment' | 'other';
export type CategoryKind = 'income' | 'expense';
export type TxKind = 'income' | 'expense' | 'transfer' | 'card_payment';
export type TxStatus = 'planned' | 'pending' | 'paid' | 'received' | 'cancelled';
export type PaymentMethod = 'pix' | 'debit' | 'credit_card' | 'cash' | 'boleto' | 'transfer' | 'auto_debit' | 'other';
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurrenceStatus = 'active' | 'paused' | 'cancelled';
export type InvoiceStatus = 'open' | 'closed' | 'partial' | 'paid' | 'overdue';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  status: UserStatus;
  created_at: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  kind: 'personal' | 'shared';
  role: WorkspaceRole;
  is_support: boolean;
  expires_at: string | null;
  owner_id: string;
}

export interface Preferences {
  user_id: string;
  theme: 'system' | 'light' | 'dark';
  active_workspace_id: string | null;
  hide_values: boolean;
  budget_alerts: boolean;
  due_alerts: boolean;
  renda_alerts?: boolean;
}

export interface SessionContext {
  profile: Profile | null;
  status: UserStatus | null;
  is_app_owner: boolean;
  workspaces: WorkspaceSummary[];
  preferences: Preferences | null;
}

export interface AppSettings {
  app_name: string;
  tagline: string;
  logo_url: string | null;
  primary_color: string;
  signup_mode: 'open' | 'invite_only';
  features: { shared_workspaces?: boolean; attachments?: boolean; exports?: boolean; support_access?: boolean };
  limits: {
    max_workspaces_per_user?: number;
    max_members_per_workspace?: number;
    max_transactions_per_month?: number;
    max_attachment_mb?: number;
  };
  min_client_version: string | null;
  maintenance_message: string | null;
  updated_at: string;
  /** chave pública dos avisos no celular (gerada pela rotina diária) */
  vapid_public_key?: string | null;
}

export interface Account {
  id: string;
  workspace_id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  initial_balance_cents: number;
  color: string;
  include_in_total: boolean;
  archived: boolean;
  sort_order: number;
  created_at: string;
}

export interface AccountBalance {
  account_id: string;
  workspace_id: string;
  current_balance_cents: number;
  realized_balance_cents: number;
  projected_balance_cents: number;
  pending_in_cents: number;
  pending_out_cents: number;
}

export interface Category {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  is_fixed: boolean;
  archived: boolean;
}

export interface CreditCard {
  id: string;
  workspace_id: string;
  name: string;
  brand: string | null;
  last_digits: string | null;
  limit_cents: number;
  closing_day: number;
  due_day: number;
  color: string;
  default_payment_account_id: string | null;
  archived: boolean;
}

export interface CardLimit {
  card_id: string;
  workspace_id: string;
  limit_cents: number;
  used_cents: number;
  available_cents: number;
}

export interface InvoiceSummary {
  id: string;
  workspace_id: string;
  card_id: string;
  reference_month: ISODate;
  closing_date: ISODate;
  due_date: ISODate;
  total_cents: number;
  items: number;
  paid_cents: number;
  remaining_cents: number;
  status: InvoiceStatus;
}

export interface Transaction {
  id: string;
  workspace_id: string;
  kind: TxKind;
  status: TxStatus;
  description: string;
  amount_cents: number;
  paid_cents: number;
  settled_principal_cents: number;
  occurred_on: ISODate;
  due_on: ISODate | null;
  category_id: string | null;
  account_id: string | null;
  destination_account_id: string | null;
  card_id: string | null;
  invoice_id: string | null;
  payment_method: PaymentMethod | null;
  tags: string[];
  notes: string | null;
  attachment_path: string | null;
  installment_group_id: string | null;
  installment_number: number | null;
  installments_total: number | null;
  recurrence_id: string | null;
  recurrence_date: ISODate | null;
  recurrence_detached: boolean;
  client_request_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Settlement {
  id: string;
  transaction_id: string;
  principal_cents: number;
  interest_cents: number;
  discount_cents: number;
  paid_on: ISODate;
  notes: string | null;
  created_at: string;
}

export interface Recurrence {
  id: string;
  workspace_id: string;
  kind: 'income' | 'expense';
  description: string;
  amount_cents: number;
  category_id: string | null;
  account_id: string | null;
  card_id: string | null;
  payment_method: PaymentMethod | null;
  tags: string[];
  notes: string | null;
  frequency: RecurrenceFreq;
  interval_count: number;
  start_date: ISODate;
  end_date: ISODate | null;
  occurrences_generated: number;
  status: RecurrenceStatus;
}

export interface BudgetProgress {
  budget_id: string;
  category_id: string;
  name: string;
  color: string;
  icon: string;
  limit_cents: number;
  spent_cents: number;
  alert_thresholds: number[];
}

export interface Goal {
  id: string;
  workspace_id: string;
  name: string;
  target_cents: number;
  saved_cents: number;
  deadline: ISODate | null;
  color: string;
  icon: string;
  archived: boolean;
  created_at: string;
}

export interface MonthlyRow {
  month: ISODate;
  income_cents: number;
  expense_cents: number;
  income_realized_cents: number;
  expense_realized_cents: number;
  fixed_expense_cents: number;
  variable_expense_cents: number;
}

export interface CategoryTotal {
  category_id: string | null;
  name: string;
  color: string;
  icon: string;
  total_cents: number;
  items: number;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export interface Member {
  user_id: string;
  email: string;
  full_name: string | null;
  role: WorkspaceRole;
  is_support: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface Invite {
  id: string;
  workspace_id: string | null;
  email: string | null;
  role: WorkspaceRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export type AssetType = 'fii' | 'stock';

export interface FiiPosition {
  id: string;
  workspace_id: string;
  ticker: string;
  asset_type: AssetType;
  quantity: number;
  avg_price_cents: number | null;
  created_at: string;
}

export interface FiiFund {
  code: string;
  name: string | null;
  administrator: string | null;
  not_found: boolean;
  synced_at: string;
}

export interface FiiDistribution {
  code: string;
  isin: string;
  kind: string;
  record_date: string | null;
  payment_date: string;
  approved_on: string | null;
  rate: number;
  related_to: string | null;
}

export interface FiiTrade {
  id: string;
  workspace_id: string;
  position_id: string;
  /** null = "já tinha antes" */
  trade_date: string | null;
  quantity: number;
  price_cents: number | null;
  created_at: string;
}

export interface StockCompany {
  code: string;
  name: string | null;
  not_found: boolean;
  synced_at: string;
}

export interface StockDistribution {
  code: string;
  isin: string;
  kind: string;
  record_date: string | null;
  payment_date: string | null;
  approved_on: string | null;
  rate: number;
  related_to: string | null;
}

export interface AssetQuote {
  ticker: string;
  price: number;
  change_pct: number | null;
  synced_at: string;
}

export interface RendaSettings {
  workspace_id: string;
  account_id: string | null;
  auto_launch: boolean;
  auto_since: string | null;
  income_goal_cents: number | null;
}
