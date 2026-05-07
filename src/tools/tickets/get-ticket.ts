import { BaseTool } from '../base.js';
import { ZendeskAPIClient, ZendeskTicket, ZendeskComment } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface GetTicketParams {
  id: number;
  include_comments?: boolean;
  comment_limit?: number;
}

interface ShowTicketResponse {
  ticket: ZendeskTicket;
}

interface CommentsResponse {
  comments: ZendeskComment[];
  count?: number;
  next_page?: string | null;
}

export class GetTicketTool extends BaseTool<GetTicketParams> {
  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_ticket_get',
      'Get a ticket by ID, optionally including its comment thread.',
      {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Ticket ID' },
          include_comments: {
            type: 'boolean',
            description: 'Whether to fetch the ticket comments',
            default: true,
          },
          comment_limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 50,
            description: 'Max number of comments to return (most recent first)',
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
    const limit = params.comment_limit ?? 50;

    const ticketResp = await this.apiClient.get<ShowTicketResponse>(`/tickets/${params.id}.json`);
    const t = ticketResp.ticket;

    const result: Record<string, unknown> = {
      id: t.id,
      subject: t.subject,
      description: t.description,
      status: t.status,
      priority: t.priority,
      type: t.type,
      requester_id: t.requester_id,
      assignee_id: t.assignee_id,
      organization_id: t.organization_id,
      group_id: t.group_id,
      tags: t.tags ?? [],
      created_at: t.created_at,
      updated_at: t.updated_at,
    };

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
}
