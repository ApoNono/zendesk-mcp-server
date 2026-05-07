import { BaseTool } from '../base.js';
import {
  ZendeskAPIClient,
  ZendeskTicket,
  ZendeskComment,
  ZendeskUser,
  ZendeskOrganization,
  ZendeskTicketField,
} from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface GetTicketParams {
  id: number;
  include_comments?: boolean;
  comment_limit?: number;
  include_context?: boolean;
}

interface ShowTicketResponse {
  ticket: ZendeskTicket;
  users?: ZendeskUser[];
  organizations?: ZendeskOrganization[];
}

interface CommentsResponse {
  comments: ZendeskComment[];
  count?: number;
  next_page?: string | null;
}

interface TicketFieldsResponse {
  ticket_fields: ZendeskTicketField[];
}

export class GetTicketTool extends BaseTool<GetTicketParams> {
  // Process-lifetime cache: ticket field id → human-readable title.
  // Lazy-loaded once, then reused. Restart the server to refresh.
  private static fieldNameCache: Map<number, string> | null = null;
  private static fieldCacheLoading: Promise<Map<number, string>> | null = null;

  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_ticket_get',
      'Get a Zendesk ticket by ID. By default side-loads requester + organization context, flattens custom fields to readable names, and includes the comment thread. Use this as the entry point for any ticket-centric workflow.',
      {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Ticket ID' },
          include_comments: {
            type: 'boolean',
            description: 'Fetch the ticket comments',
            default: true,
          },
          comment_limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
            description: 'Max number of comments to return (most recent first)',
          },
          include_context: {
            type: 'boolean',
            description:
              'Side-load requester + organization details and resolve custom field names. Adds a small extra API call only on the first ticket fetch per session.',
            default: true,
          },
        },
        required: ['id'],
      },
      apiClient,
      logger,
    );
  }

  protected async executeInternal(params: GetTicketParams): Promise<unknown> {
    const includeComments = params.include_comments !== false;
    const includeContext = params.include_context !== false;
    const limit = params.comment_limit ?? 50;

    const ticketUrl = includeContext
      ? `/tickets/${params.id}.json?include=users,organizations`
      : `/tickets/${params.id}.json`;
    const ticketResp = await this.apiClient.get<ShowTicketResponse>(ticketUrl);
    const t = ticketResp.ticket;

    const usersById = new Map<number, ZendeskUser>((ticketResp.users ?? []).map((u) => [u.id, u]));
    const orgsById = new Map<number, ZendeskOrganization>(
      (ticketResp.organizations ?? []).map((o) => [o.id, o]),
    );

    const requester = t.requester_id ? usersById.get(t.requester_id) : undefined;
    const assignee = t.assignee_id ? usersById.get(t.assignee_id) : undefined;
    const org = t.organization_id ? orgsById.get(t.organization_id) : undefined;

    let customFieldsFlat: Record<string, unknown> = {};
    if (includeContext && t.custom_fields?.length) {
      const fieldNames = await this.getFieldNameMap();
      customFieldsFlat = flattenCustomFields(t.custom_fields, fieldNames);
    }

    const result: Record<string, unknown> = {
      id: t.id,
      subject: t.subject,
      description: t.description,
      status: t.status,
      priority: t.priority,
      type: t.type,
      group_id: t.group_id,
      tags: t.tags ?? [],
      created_at: t.created_at,
      updated_at: t.updated_at,
    };

    if (requester) {
      result.requester = {
        id: requester.id,
        name: requester.name,
        email: requester.email,
        organization_id: requester.organization_id,
      };
    } else if (t.requester_id) {
      result.requester_id = t.requester_id;
    }

    if (assignee) {
      result.assignee = { id: assignee.id, name: assignee.name, email: assignee.email };
    } else if (t.assignee_id) {
      result.assignee_id = t.assignee_id;
    }

    if (org) {
      result.organization = {
        id: org.id,
        name: org.name,
        domain_names: org.domain_names ?? [],
        external_id: org.external_id,
        tags: org.tags ?? [],
      };
    } else if (t.organization_id) {
      result.organization_id = t.organization_id;
    }

    if (Object.keys(customFieldsFlat).length > 0) {
      result.custom_fields = customFieldsFlat;
    }

    if (includeComments) {
      const commentsResp = await this.apiClient.get<CommentsResponse>(
        `/tickets/${params.id}/comments.json`,
        { per_page: limit, sort_order: 'desc' },
      );
      result.comments = commentsResp.comments.map((c) => ({
        id: c.id,
        author_id: c.author_id,
        public: c.public,
        body: c.plain_body || c.body,
        created_at: c.created_at,
      }));
      result.comment_count = commentsResp.count ?? commentsResp.comments.length;
    }

    return result;
  }

  private async getFieldNameMap(): Promise<Map<number, string>> {
    if (GetTicketTool.fieldNameCache) return GetTicketTool.fieldNameCache;

    if (!GetTicketTool.fieldCacheLoading) {
      GetTicketTool.fieldCacheLoading = this.apiClient
        .get<TicketFieldsResponse>('/ticket_fields.json')
        .then((resp) => {
          const map = new Map<number, string>();
          for (const f of resp.ticket_fields) {
            if (f.active) map.set(f.id, slugifyFieldName(f.title));
          }
          GetTicketTool.fieldNameCache = map;
          this.logger.debug(`Loaded ${map.size} ticket field definitions`);
          return map;
        })
        .catch((err) => {
          GetTicketTool.fieldCacheLoading = null;
          throw err;
        });
    }

    return GetTicketTool.fieldCacheLoading;
  }
}

function slugifyFieldName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

function flattenCustomFields(
  fields: Array<{ id: number; value: unknown }>,
  nameMap: Map<number, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.value === null || f.value === undefined || f.value === '') continue;
    const name = nameMap.get(f.id) ?? `field_${f.id}`;
    out[name] = f.value;
  }
  return out;
}
