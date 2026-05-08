export interface QueryParams {
  [key: string]: string | number | boolean | undefined;
}

export interface APIClientConfig {
  baseUrl: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface RequestConfig {
  headers?: Record<string, string>;
  timeout?: number;
  params?: QueryParams;
}

// --- Zendesk resource shapes ---
// These describe just the fields we surface to MCP clients. Zendesk responses
// contain many more fields; we don't model them all.

export interface ZendeskArticle {
  id: number;
  url: string;
  html_url: string;
  title: string;
  body?: string | null;
  locale: string;
  source_locale?: string;
  author_id?: number;
  section_id?: number | null;
  draft?: boolean;
  promoted?: boolean;
  outdated?: boolean;
  label_names?: string[];
  created_at: string;
  updated_at: string;
}

export interface ZendeskTicket {
  id: number;
  url: string;
  subject: string;
  description?: string;
  status: 'new' | 'open' | 'pending' | 'hold' | 'solved' | 'closed';
  priority?: 'urgent' | 'high' | 'normal' | 'low' | null;
  type?: 'problem' | 'incident' | 'question' | 'task' | null;
  requester_id?: number;
  assignee_id?: number | null;
  organization_id?: number | null;
  group_id?: number | null;
  tags?: string[];
  custom_fields?: Array<{ id: number; value: unknown }>;
  created_at: string;
  updated_at: string;
}

export interface ZendeskOrganization {
  id: number;
  url: string;
  name: string;
  domain_names?: string[];
  details?: string | null;
  notes?: string | null;
  group_id?: number | null;
  shared_tickets?: boolean;
  shared_comments?: boolean;
  external_id?: string | null;
  tags?: string[];
  organization_fields?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ZendeskUser {
  id: number;
  url: string;
  name: string;
  email?: string | null;
  role?: 'end-user' | 'agent' | 'admin';
  active?: boolean;
  organization_id?: number | null;
  phone?: string | null;
  time_zone?: string;
  locale?: string;
  tags?: string[];
  user_fields?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ZendeskTicketField {
  id: number;
  type: string;
  title: string;
  raw_title?: string;
  description?: string;
  active: boolean;
}

export type SatisfactionScore =
  | 'offered'
  | 'unoffered'
  | 'received'
  | 'received_with_comment'
  | 'good'
  | 'good_with_comment'
  | 'bad'
  | 'bad_with_comment';

export interface ZendeskSatisfactionRating {
  id: number;
  url: string;
  assignee_id?: number | null;
  group_id?: number | null;
  requester_id?: number;
  ticket_id?: number;
  score: SatisfactionScore;
  comment?: string | null;
  reason?: string | null;
  reason_code?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ZendeskComment {
  id: number;
  type: 'Comment' | 'VoiceComment';
  author_id: number;
  body: string;
  html_body?: string;
  plain_body?: string;
  public: boolean;
  created_at: string;
}
