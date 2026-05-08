import { jest } from '@jest/globals';
import { SatisfactionSummaryTool } from '../../src/tools/satisfaction/summary.js';
import { ListSatisfactionRatingsTool } from '../../src/tools/satisfaction/list-ratings.js';
import { ZendeskAPIClient } from '../../src/api/index.js';
import { Logger } from '../../src/utils/logger.js';

const logger = new Logger({ level: 'fatal' });

function clientReturning(response: unknown): ZendeskAPIClient {
  return {
    get: jest.fn(async () => response),
  } as unknown as ZendeskAPIClient;
}

describe('SatisfactionSummaryTool', () => {
  it('refuses when window exceeds 180 days', async () => {
    const tool = new SatisfactionSummaryTool(clientReturning({}), logger);
    const result = (await tool.execute({
      start_date: '2024-01-01',
      end_date: '2026-01-01',
    })) as Record<string, unknown>;
    expect(result.too_broad).toBe(true);
    expect(result.window_days).toBeGreaterThan(180);
  });

  it('refuses when total ratings exceed cap', async () => {
    const tool = new SatisfactionSummaryTool(
      clientReturning({ satisfaction_ratings: [], count: 10000, next_page: null }),
      logger,
    );
    const result = (await tool.execute({
      start_date: '2026-04-01',
      end_date: '2026-04-30',
    })) as Record<string, unknown>;
    expect(result.too_broad).toBe(true);
    expect(result.estimated_count).toBe(10000);
  });

  it('aggregates ratings into pct_positive and counts by score', async () => {
    const ratings = [
      { id: 1, score: 'good', reason: null, url: 'x', created_at: 'x', updated_at: 'x' },
      { id: 2, score: 'good', reason: 'Fast response', url: 'x', created_at: 'x', updated_at: 'x' },
      {
        id: 3,
        score: 'good_with_comment',
        reason: 'Fast response',
        url: 'x',
        created_at: 'x',
        updated_at: 'x',
      },
      {
        id: 4,
        score: 'bad',
        reason: 'Slow response',
        url: 'x',
        created_at: 'x',
        updated_at: 'x',
      },
      { id: 5, score: 'offered', reason: null, url: 'x', created_at: 'x', updated_at: 'x' },
    ];
    const tool = new SatisfactionSummaryTool(
      clientReturning({ satisfaction_ratings: ratings, count: 5, next_page: null }),
      logger,
    );

    const result = (await tool.execute({
      start_date: '2026-04-01',
      end_date: '2026-04-30',
    })) as Record<string, unknown>;

    const counts = result.counts as Record<string, unknown>;
    expect(counts.positive).toBe(3);
    expect(counts.negative).toBe(1);
    expect(counts.total_rated).toBe(4);
    // 3 / 4 = 75.0%
    expect(result.pct_positive).toBe(75);

    const reasons = result.top_reasons as Array<{ reason: string; count: number }>;
    expect(reasons.find((r) => r.reason === 'Fast response')?.count).toBe(2);
  });
});

describe('ListSatisfactionRatingsTool', () => {
  it('refuses when no filters are provided', async () => {
    const tool = new ListSatisfactionRatingsTool(clientReturning({}), logger);
    const result = (await tool.execute({})) as Record<string, unknown>;
    expect(result.too_broad).toBe(true);
    expect(result.suggestion).toMatch(/at least one filter/i);
  });

  it('passes through with score filter only', async () => {
    const tool = new ListSatisfactionRatingsTool(
      clientReturning({ satisfaction_ratings: [], count: 0, next_page: null }),
      logger,
    );
    const result = (await tool.execute({ score: 'bad' })) as Record<string, unknown>;
    expect(result.too_broad).toBeUndefined();
    expect(result.total_count).toBe(0);
  });
});
