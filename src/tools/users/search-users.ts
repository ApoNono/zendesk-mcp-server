import { BaseTool } from '../base.js';
import { ZendeskAPIClient, ZendeskUser } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface SearchUsersParams {
  query: string;
  per_page?: number;
}

interface SearchUsersResponse {
  users: ZendeskUser[];
  count: number;
  next_page?: string | null;
}

export class SearchUsersTool extends BaseTool<SearchUsersParams> {
  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_user_search',
      'Find Zendesk users by email, name, or other identifying detail. Returns up to 25 matches by default. Use this to resolve a customer email to a user ID before fetching their tickets.',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search query. Most useful: full email address, partial name, or external_id. Minimum 2 characters.',
            minLength: 2,
          },
          per_page: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 25,
          },
        },
        required: ['query'],
      },
      apiClient,
      logger,
    );
  }

  protected async executeInternal(params: SearchUsersParams): Promise<unknown> {
    const response = await this.apiClient.get<SearchUsersResponse>('/users/search.json', {
      query: params.query,
      per_page: params.per_page ?? 25,
    });

    const tooBroad = response.count > 100;

    return {
      count: response.count,
      returned: response.users.length,
      too_broad: tooBroad,
      ...(tooBroad && {
        suggestion:
          'Search returned more than 100 matches. Narrow with a more specific query (full email or exact name).',
      }),
      results: response.users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: u.active,
        organization_id: u.organization_id,
        time_zone: u.time_zone,
        tags: u.tags ?? [],
        created_at: u.created_at,
      })),
    };
  }
}
