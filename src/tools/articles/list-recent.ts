import { MultiBrandTool } from '../multi-brand-base.js';
import { BrandRegistry, ZendeskArticle } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface ListRecentParams {
  since?: string;
  before?: string;
  brand?: string;
  section_id?: number;
  category_id?: number;
  per_page?: number;
  page?: number;
}

interface ArticlesResponse {
  articles: ZendeskArticle[];
  count?: number;
  next_page?: string | null;
  previous_page?: string | null;
}

const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_PER_PAGE = 100;

export class ListRecentArticlesTool extends MultiBrandTool<ListRecentParams> {
  constructor(brandRegistry: BrandRegistry, logger: Logger) {
    super(
      'zd_article_list_recent',
      'List articles updated within a date range, sorted by updated_at descending. Defaults to the last 7 days if no dates provided. Use `since=<date>` for "what changed" workflows and `before=<date>` for stale-article audits (articles NOT updated since). Restrict to one brand with `brand` or leave blank for the primary brand.',
      {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            format: 'date',
            description:
              'ISO date (YYYY-MM-DD). Only articles updated on or after this date. Defaults to 7 days ago if neither `since` nor `before` provided.',
          },
          before: {
            type: 'string',
            format: 'date',
            description: 'ISO date (YYYY-MM-DD). Only articles updated on or before this date.',
          },
          brand: {
            type: 'string',
            description:
              'Brand subdomain to query. Defaults to the primary configured brand. Use zd_sections_list to see brand names.',
          },
          section_id: {
            type: 'integer',
            description: 'Restrict to articles in a specific section',
          },
          category_id: {
            type: 'integer',
            description: 'Restrict to articles in a specific category',
          },
          per_page: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_PER_PAGE,
            default: 25,
          },
          page: { type: 'integer', minimum: 1, default: 1 },
        },
      },
      brandRegistry,
      logger,
    );
  }

  protected async executeInternal(params: ListRecentParams): Promise<unknown> {
    const brandSubdomain = params.brand ?? this.brands.primary().subdomain;
    if (!this.brands.hasBrand(brandSubdomain)) {
      return {
        error: `Brand '${brandSubdomain}' is not configured. Configured brands: ${this.brands
          .list()
          .map((b) => b.subdomain)
          .join(', ')}`,
      };
    }
    const client = this.brands.getClient(brandSubdomain);

    // Default: last 7 days if neither since nor before provided.
    const sinceDate = params.since
      ? parseDate(params.since)
      : params.before
        ? undefined
        : daysAgo(DEFAULT_LOOKBACK_DAYS);
    const beforeDate = params.before ? parseDate(params.before) : undefined;

    // Determine endpoint. The incremental endpoint is optimised for
    // "articles updated since X" — real-time (not through the 5-min search
    // index). Falls back to the general list endpoint when we need a
    // trailing-edge filter (`before` only).
    const useIncremental = !!sinceDate;

    let path: string;
    const queryParams: Record<string, string | number> = {
      per_page: params.per_page ?? 25,
      page: params.page ?? 1,
      sort_by: 'updated_at',
      sort_order: 'desc',
    };

    if (useIncremental) {
      path = '/help_center/incremental/articles.json';
      queryParams.start_time = Math.floor(sinceDate!.getTime() / 1000);
    } else {
      path = '/help_center/articles.json';
    }

    if (params.section_id !== undefined) queryParams.section_id = params.section_id;
    if (params.category_id !== undefined) queryParams.category_id = params.category_id;

    const response = await client.get<ArticlesResponse>(path, queryParams);
    let articles = response.articles;

    // Apply the `before` filter client-side (Zendesk endpoints don't
    // natively support "updated before"). Incremental returns everything
    // since start_time; general list returns everything in creation order.
    if (beforeDate) {
      articles = articles.filter((a) => new Date(a.updated_at) <= beforeDate);
    }

    // Restrict incremental results to updated_at within the requested window
    // (incremental returns articles by ANY change, including some system
    // ones — filtering by updated_at is safer).
    if (sinceDate) {
      articles = articles.filter((a) => new Date(a.updated_at) >= sinceDate);
    }

    return {
      brand: brandSubdomain,
      window: {
        since: sinceDate?.toISOString().slice(0, 10),
        before: beforeDate?.toISOString().slice(0, 10),
      },
      total_returned: articles.length,
      has_more: !!response.next_page,
      results: articles.map((a) => ({
        id: a.id,
        title: a.title,
        url: a.html_url,
        section_id: a.section_id,
        locale: a.locale,
        draft: a.draft ?? false,
        promoted: a.promoted ?? false,
        outdated: a.outdated ?? false,
        labels: a.label_names ?? [],
        updated_at: a.updated_at,
        created_at: a.created_at,
      })),
    };
  }
}

function parseDate(iso: string): Date {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`);
  return d;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}
