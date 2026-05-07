import { BaseTool } from '../base.js';
import { ZendeskAPIClient, ZendeskOrganization } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface SearchOrganizationsParams {
  query: string;
}

interface AutocompleteResponse {
  organizations: ZendeskOrganization[];
}

export class SearchOrganizationsTool extends BaseTool<SearchOrganizationsParams> {
  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_organization_search',
      'Find Zendesk organizations by name (autocomplete-style prefix match). Returns up to 25 matches. Useful for resolving customer/company names to organization IDs before scoping a ticket query.',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Name prefix to match (minimum 2 characters)',
            minLength: 2,
          },
        },
        required: ['query'],
      },
      apiClient,
      logger,
    );
  }

  protected async executeInternal(params: SearchOrganizationsParams): Promise<unknown> {
    const response = await this.apiClient.get<AutocompleteResponse>(
      '/organizations/autocomplete.json',
      { name: params.query },
    );

    return {
      count: response.organizations.length,
      results: response.organizations.map((o) => ({
        id: o.id,
        name: o.name,
        domain_names: o.domain_names ?? [],
        external_id: o.external_id,
        tags: o.tags ?? [],
        created_at: o.created_at,
        updated_at: o.updated_at,
      })),
    };
  }
}
