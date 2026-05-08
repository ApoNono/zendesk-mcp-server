import { jest } from '@jest/globals';
import { CountTicketsByTool } from '../../src/tools/tickets/count-by.js';
import { ZendeskAPIClient } from '../../src/api/index.js';
import { Logger } from '../../src/utils/logger.js';

const logger = new Logger({ level: 'fatal' });

function makeMockClient(getResponses: Record<string, unknown>): ZendeskAPIClient {
  return {
    get: jest.fn(async (endpoint: string, params?: Record<string, unknown>) => {
      const key = `${endpoint}?${JSON.stringify(params ?? {})}`;
      if (key in getResponses) return getResponses[key];
      // Match by endpoint only if params not registered
      if (endpoint in getResponses) return getResponses[endpoint];
      throw new Error(`Unmocked GET: ${key}`);
    }),
  } as unknown as ZendeskAPIClient;
}

describe('CountTicketsByTool', () => {
  it('refuses with too_broad when no filters are provided', async () => {
    const tool = new CountTicketsByTool(makeMockClient({}), logger);
    const result = (await tool.execute({ group_by: 'status' })) as Record<string, unknown>;
    expect(result.too_broad).toBe(true);
    expect(result.suggestion).toMatch(/at least one filter/i);
  });

  it('runs one count query per group value when filtered', async () => {
    const get = jest.fn(async () => ({ count: { value: 5 } }));
    const tool = new CountTicketsByTool({ get } as unknown as ZendeskAPIClient, logger);

    const result = (await tool.execute({
      group_by: 'priority',
      created_after: '2026-01-01',
    })) as Record<string, unknown>;

    // priority has 4 values → 4 search calls
    expect(get).toHaveBeenCalledTimes(4);
    expect(result.group_by).toBe('priority');
    expect(result.total).toBe(20);
    const buckets = result.buckets as Array<{ value: string; count: number }>;
    expect(buckets).toHaveLength(4);
    expect(buckets.every((b) => b.count === 5)).toBe(true);
  });

  it('sorts buckets descending by count', async () => {
    let i = 0;
    const get = jest.fn(async () => ({ count: { value: [1, 10, 5, 100][i++] } }));
    const tool = new CountTicketsByTool({ get } as unknown as ZendeskAPIClient, logger);

    const result = (await tool.execute({
      group_by: 'priority',
      tag: 'foo',
    })) as Record<string, unknown>;

    const buckets = result.buckets as Array<{ value: string; count: number }>;
    expect(buckets[0].count).toBe(100);
    expect(buckets[3].count).toBe(1);
  });

  it('builds a search query that includes type:ticket and the group filter', async () => {
    const seenQueries: string[] = [];
    const get = jest.fn(async (_endpoint: string, params: { query: string }) => {
      seenQueries.push(params.query);
      return { count: { value: 0 } };
    });
    const tool = new CountTicketsByTool({ get } as unknown as ZendeskAPIClient, logger);

    await tool.execute({
      group_by: 'status',
      organization_id: 42,
      tag: 'urgent',
    });

    for (const q of seenQueries) {
      expect(q).toContain('type:ticket');
      expect(q).toContain('organization:42');
      expect(q).toContain('tags:urgent');
      expect(q).toMatch(/status:\w+/);
    }
  });
});
