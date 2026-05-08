import { BaseTool } from '../base.js';
import { ZendeskAPIClient } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface CountByParams {
  group_by: 'status' | 'priority' | 'type';
  created_after?: string;
  created_before?: string;
  organization_id?: number;
  tag?: string;
  requester_id?: number;
}

interface SearchCountResponse {
  count: { value: number; refreshed_at?: string };
}

const GROUP_VALUES: Record<CountByParams['group_by'], string[]> = {
  status: ['new', 'open', 'pending', 'hold', 'solved', 'closed'],
  priority: ['low', 'normal', 'high', 'urgent'],
  type: ['question', 'incident', 'problem', 'task'],
};

export class CountTicketsByTool extends BaseTool<CountByParams> {
  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_tickets_count_by',
      "Count tickets grouped by status, priority, or type, with at least one filter applied (date range, organization, tag, or requester). Uses Zendesk's search API which is approximate and refreshed every ~5 minutes — fine for trend analysis, not for real-time dashboards.",
      {
        type: 'object',
        properties: {
          group_by: {
            type: 'string',
            enum: ['status', 'priority', 'type'],
            description: 'Dimension to group counts by',
          },
          created_after: {
            type: 'string',
            format: 'date',
            description: 'Only count tickets created on or after this ISO date (YYYY-MM-DD)',
          },
          created_before: {
            type: 'string',
            format: 'date',
            description: 'Only count tickets created on or before this ISO date (YYYY-MM-DD)',
          },
          organization_id: {
            type: 'integer',
            description: 'Restrict to tickets from this organization',
          },
          tag: {
            type: 'string',
            description: 'Restrict to tickets with this tag',
          },
          requester_id: {
            type: 'integer',
            description: 'Restrict to tickets from this requester',
          },
        },
        required: ['group_by'],
      },
      apiClient,
      logger,
    );
  }

  protected async executeInternal(params: CountByParams): Promise<unknown> {
    const filters: string[] = ['type:ticket'];
    let hasFilter = false;

    if (params.created_after) {
      filters.push(`created>=${formatDate(params.created_after)}`);
      hasFilter = true;
    }
    if (params.created_before) {
      filters.push(`created<=${formatDate(params.created_before)}`);
      hasFilter = true;
    }
    if (params.organization_id !== undefined) {
      filters.push(`organization:${params.organization_id}`);
      hasFilter = true;
    }
    if (params.tag) {
      filters.push(`tags:${params.tag}`);
      hasFilter = true;
    }
    if (params.requester_id !== undefined) {
      filters.push(`requester:${params.requester_id}`);
      hasFilter = true;
    }

    if (!hasFilter) {
      return {
        too_broad: true,
        suggestion:
          'Provide at least one filter: created_after, created_before, organization_id, tag, or requester_id. An unfiltered count_by could span your entire ticket history.',
      };
    }

    const groupValues = GROUP_VALUES[params.group_by];
    const baseQuery = filters.join(' ');

    const buckets = await Promise.all(
      groupValues.map(async (value) => {
        const query = `${baseQuery} ${params.group_by}:${value}`;
        const resp = await this.apiClient.get<SearchCountResponse>('/search/count.json', {
          query,
        });
        return { value, count: resp.count.value };
      }),
    );

    const total = buckets.reduce((sum, b) => sum + b.count, 0);

    return {
      group_by: params.group_by,
      filter_applied: {
        created_after: params.created_after,
        created_before: params.created_before,
        organization_id: params.organization_id,
        tag: params.tag,
        requester_id: params.requester_id,
      },
      total,
      buckets: buckets.sort((a, b) => b.count - a.count),
      note: 'Counts are approximate (Zendesk search index refreshes every ~5 minutes). Capped at 100,000 per bucket.',
    };
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`);
  return d.toISOString().slice(0, 10);
}
