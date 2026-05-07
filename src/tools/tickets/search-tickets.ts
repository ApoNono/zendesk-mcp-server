import { BaseTool } from '../base.js';
import { ZendeskAPIClient, ZendeskTicket } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface SearchTicketsParams {
  query: string;
  sort_by?: 'updated_at' | 'created_at' | 'priority' | 'status' | 'ticket_type';
  sort_order?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}

interface SearchResponse<T> {
  results: T[];
  count: number;
  next_page?: string | null;
  previous_page?: string | null;
}

export class SearchTicketsTool extends BaseTool<SearchTicketsParams> {
  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_ticket_search',
      'Search tickets using Zendesk Search query syntax (e.g. "type:ticket status:open priority:high"). See https://support.zendesk.com/hc/en-us/articles/4408886879258 for full syntax.',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Zendesk search query. The tool automatically scopes to type:ticket if not specified.',
            minLength: 1,
          },
          sort_by: {
            type: 'string',
            enum: ['updated_at', 'created_at', 'priority', 'status', 'ticket_type'],
            description: 'Field to sort by',
          },
          sort_order: {
            type: 'string',
            enum: ['asc', 'desc'],
            default: 'desc',
          },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          page: { type: 'integer', minimum: 1, default: 1 },
        },
        required: ['query'],
      },
      apiClient,
      logger,
    );
  }

  protected async executeInternal(params: SearchTicketsParams): Promise<unknown> {
    const query = /\btype:\w+/.test(params.query) ? params.query : `type:ticket ${params.query}`;

    const queryParams: Record<string, string | number> = {
      query,
      per_page: params.per_page ?? 25,
      page: params.page ?? 1,
    };
    if (params.sort_by) queryParams.sort_by = params.sort_by;
    if (params.sort_order) queryParams.sort_order = params.sort_order;

    const response = await this.apiClient.get<SearchResponse<ZendeskTicket>>(
      '/search.json',
      queryParams,
    );

    return {
      count: response.count,
      page: params.page ?? 1,
      per_page: params.per_page ?? 25,
      has_more: !!response.next_page,
      results: response.results.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        type: t.type,
        requester_id: t.requester_id,
        assignee_id: t.assignee_id,
        organization_id: t.organization_id,
        tags: t.tags ?? [],
        created_at: t.created_at,
        updated_at: t.updated_at,
      })),
    };
  }
}
