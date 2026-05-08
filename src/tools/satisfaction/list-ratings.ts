import { BaseTool } from '../base.js';
import { ZendeskAPIClient, ZendeskSatisfactionRating } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface ListRatingsParams {
  start_date?: string;
  end_date?: string;
  score?: string;
  per_page?: number;
}

interface SatisfactionRatingsResponse {
  satisfaction_ratings: ZendeskSatisfactionRating[];
  count: number;
  next_page?: string | null;
}

export class ListSatisfactionRatingsTool extends BaseTool<ListRatingsParams> {
  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_satisfaction_ratings_list',
      'Drill-down: list individual satisfaction ratings with their comments and reasons. Useful for "what specifically did unhappy customers say?" Requires at least one filter (date range OR score) to avoid dumping the entire history.',
      {
        type: 'object',
        properties: {
          start_date: {
            type: 'string',
            format: 'date',
            description: 'ISO date (YYYY-MM-DD). Filter ratings created on or after this date.',
          },
          end_date: {
            type: 'string',
            format: 'date',
            description: 'ISO date (YYYY-MM-DD). Filter ratings created on or before this date.',
          },
          score: {
            type: 'string',
            enum: [
              'offered',
              'unoffered',
              'received',
              'received_with_comment',
              'good',
              'good_with_comment',
              'bad',
              'bad_with_comment',
            ],
            description: 'Filter by score type',
          },
          per_page: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 25,
          },
        },
      },
      apiClient,
      logger,
    );
  }

  protected async executeInternal(params: ListRatingsParams): Promise<unknown> {
    if (!params.start_date && !params.end_date && !params.score) {
      return {
        too_broad: true,
        suggestion:
          'Provide at least one filter: start_date, end_date, or score. Without filters this tool would return your entire satisfaction history.',
      };
    }

    const queryParams: Record<string, string | number> = {
      per_page: params.per_page ?? 25,
    };
    if (params.start_date) queryParams.start_time = isoToEpoch(params.start_date);
    if (params.end_date) queryParams.end_time = isoToEpoch(params.end_date);
    if (params.score) queryParams.score = params.score;

    const response = await this.apiClient.get<SatisfactionRatingsResponse>(
      '/satisfaction_ratings.json',
      queryParams,
    );

    return {
      total_count: response.count,
      returned: response.satisfaction_ratings.length,
      has_more: !!response.next_page,
      results: response.satisfaction_ratings.map((r) => ({
        id: r.id,
        ticket_id: r.ticket_id,
        requester_id: r.requester_id,
        assignee_id: r.assignee_id,
        score: r.score,
        comment: r.comment,
        reason: r.reason,
        created_at: r.created_at,
      })),
    };
  }
}

function isoToEpoch(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`);
  return Math.floor(d.getTime() / 1000);
}
