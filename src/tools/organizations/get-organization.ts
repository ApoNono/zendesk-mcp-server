import { BaseTool } from '../base.js';
import { ZendeskAPIClient, ZendeskOrganization } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface GetOrganizationParams {
  id: number;
}

interface ShowOrganizationResponse {
  organization: ZendeskOrganization;
}

export class GetOrganizationTool extends BaseTool<GetOrganizationParams> {
  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_organization_get',
      'Get full details for a Zendesk organization by ID, including domain names, tags, and any custom organization fields.',
      {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Organization ID' },
        },
        required: ['id'],
      },
      apiClient,
      logger,
    );
  }

  protected async executeInternal(params: GetOrganizationParams): Promise<unknown> {
    const response = await this.apiClient.get<ShowOrganizationResponse>(
      `/organizations/${params.id}.json`,
    );
    const o = response.organization;

    return {
      id: o.id,
      name: o.name,
      domain_names: o.domain_names ?? [],
      details: o.details,
      notes: o.notes,
      external_id: o.external_id,
      tags: o.tags ?? [],
      organization_fields: o.organization_fields ?? {},
      shared_tickets: o.shared_tickets,
      shared_comments: o.shared_comments,
      created_at: o.created_at,
      updated_at: o.updated_at,
    };
  }
}
