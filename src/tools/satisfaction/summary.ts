import { BaseTool } from '../base.js';
import { ZendeskAPIClient, ZendeskSatisfactionRating } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface SatisfactionSummaryParams {
  start_date?: string;
  end_date?: string;
}

interface SatisfactionRatingsResponse {
  satisfaction_ratings: ZendeskSatisfactionRating[];
  count: number;
  next_page?: string | null;
}

const POSITIVE_SCORES = new Set(['good', 'good_with_comment']);
const NEGATIVE_SCORES = new Set(['bad', 'bad_with_comment']);
const SURVEY_OFFERED = new Set(['offered', 'received', 'received_with_comment']);
const SURVEY_RECEIVED = new Set([
  'received',
  'received_with_comment',
  'good',
  'good_with_comment',
  'bad',
  'bad_with_comment',
]);

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 180;
const MAX_RATINGS_TO_AGGREGATE = 5000;
const PAGE_SIZE = 100;
const MAX_PAGES = MAX_RATINGS_TO_AGGREGATE / PAGE_SIZE;

export class SatisfactionSummaryTool extends BaseTool<SatisfactionSummaryParams> {
  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_satisfaction_summary',
      'Pre-aggregated CSAT for a date range. Returns % positive, count by score, and top reasons. Defaults to the last 30 days. Refuses windows longer than 180 days or result sets larger than 5,000 ratings — narrow your range if needed.',
      {
        type: 'object',
        properties: {
          start_date: {
            type: 'string',
            format: 'date',
            description: 'ISO date (YYYY-MM-DD). Defaults to 30 days before end_date.',
          },
          end_date: {
            type: 'string',
            format: 'date',
            description: 'ISO date (YYYY-MM-DD). Defaults to today.',
          },
        },
      },
      apiClient,
      logger,
    );
  }

  protected async executeInternal(params: SatisfactionSummaryParams): Promise<unknown> {
    const { startEpoch, endEpoch, startISO, endISO } = resolveWindow(params);

    const windowDays = Math.round((endEpoch - startEpoch) / 86400);
    if (windowDays > MAX_WINDOW_DAYS) {
      return {
        too_broad: true,
        window_days: windowDays,
        max_window_days: MAX_WINDOW_DAYS,
        suggestion: `Date range spans ${windowDays} days. Narrow to ${MAX_WINDOW_DAYS} days or fewer, or call zd_satisfaction_ratings_list for drill-down on specific scores.`,
      };
    }

    const firstPage = await this.apiClient.get<SatisfactionRatingsResponse>(
      '/satisfaction_ratings.json',
      { start_time: startEpoch, end_time: endEpoch, per_page: PAGE_SIZE },
    );

    if (firstPage.count > MAX_RATINGS_TO_AGGREGATE) {
      return {
        too_broad: true,
        estimated_count: firstPage.count,
        max_count: MAX_RATINGS_TO_AGGREGATE,
        suggestion: `${firstPage.count} ratings in range. Narrow the date window to summarise fewer than ${MAX_RATINGS_TO_AGGREGATE}.`,
      };
    }

    const allRatings: ZendeskSatisfactionRating[] = [...firstPage.satisfaction_ratings];
    let nextPage = firstPage.next_page;
    let pageCount = 1;
    while (nextPage && pageCount < MAX_PAGES) {
      const resp = await this.apiClient.get<SatisfactionRatingsResponse>(
        nextPage.replace(/^.*\/api\/v2/, ''),
      );
      allRatings.push(...resp.satisfaction_ratings);
      nextPage = resp.next_page;
      pageCount++;
    }

    return aggregate(allRatings, startISO, endISO, firstPage.count);
  }
}

function resolveWindow(params: SatisfactionSummaryParams): {
  startEpoch: number;
  endEpoch: number;
  startISO: string;
  endISO: string;
} {
  const end = params.end_date ? parseDate(params.end_date) : new Date();
  const start = params.start_date
    ? parseDate(params.start_date)
    : new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 86400 * 1000);

  return {
    startEpoch: Math.floor(start.getTime() / 1000),
    endEpoch: Math.floor(end.getTime() / 1000),
    startISO: start.toISOString().slice(0, 10),
    endISO: end.toISOString().slice(0, 10),
  };
}

function parseDate(iso: string): Date {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`);
  return d;
}

function aggregate(
  ratings: ZendeskSatisfactionRating[],
  startISO: string,
  endISO: string,
  totalCount: number,
): Record<string, unknown> {
  const byScore: Record<string, number> = {};
  const reasonCounts = new Map<string, number>();
  let positive = 0;
  let negative = 0;
  let offered = 0;
  let received = 0;

  for (const r of ratings) {
    byScore[r.score] = (byScore[r.score] ?? 0) + 1;
    if (POSITIVE_SCORES.has(r.score)) positive++;
    if (NEGATIVE_SCORES.has(r.score)) negative++;
    if (SURVEY_OFFERED.has(r.score)) offered++;
    if (SURVEY_RECEIVED.has(r.score)) received++;

    if (r.reason) {
      reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
    }
  }

  const totalRated = positive + negative;
  const pctPositive = totalRated > 0 ? Math.round((positive / totalRated) * 1000) / 10 : null;
  const responseRate = offered > 0 ? Math.round((received / offered) * 1000) / 10 : null;

  const topReasons = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  return {
    window: { start_date: startISO, end_date: endISO },
    total_ratings: totalCount,
    aggregated: ratings.length,
    truncated: ratings.length < totalCount,
    pct_positive: pctPositive,
    response_rate_pct: responseRate,
    counts: {
      positive,
      negative,
      total_rated: totalRated,
      offered,
      received,
      by_score: byScore,
    },
    top_reasons: topReasons,
  };
}
