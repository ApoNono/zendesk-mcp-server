import { MultiBrandTool } from '../multi-brand-base.js';
import { BrandRegistry, ZendeskArticle, ZendeskAPIClient } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface SearchArticlesParams {
  query: string;
  brands?: string[];
  locale?: string;
  category?: number;
  section?: number;
  label_names?: string;
  per_page?: number;
  page?: number;
}

interface SearchArticlesResponse {
  results: ZendeskArticle[];
  count: number;
  page: number;
  per_page: number;
  next_page?: string | null;
  previous_page?: string | null;
}

interface TaggedResult {
  brand: string;
  article: ZendeskArticle;
}

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

export class SearchArticlesTool extends MultiBrandTool<SearchArticlesParams> {
  constructor(brandRegistry: BrandRegistry, logger: Logger) {
    super(
      'zd_article_search',
      "Search Help Center articles by keyword. Searches every configured brand by default; pass `brands` to restrict. Each result is tagged with its brand so downstream calls can pass `brand` back into zd_article_get. Zendesk's keyword-relevance ranking is per-brand; when searching multiple brands, results are merged and sorted by updated_at descending as a tiebreaker.",
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (required)',
            minLength: 1,
          },
          brands: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Brand subdomains to search. Omit to search every configured brand. Use zd_sections_list to see brand names.',
          },
          locale: {
            type: 'string',
            description: 'Locale to search in (e.g. "en-us")',
          },
          category: {
            type: 'integer',
            description: 'Restrict to a specific category ID',
          },
          section: {
            type: 'integer',
            description: 'Restrict to a specific section ID',
          },
          label_names: {
            type: 'string',
            description: 'Comma-separated label names to filter by',
          },
          per_page: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_PER_PAGE,
            default: DEFAULT_PER_PAGE,
          },
          page: {
            type: 'integer',
            minimum: 1,
            default: 1,
          },
        },
        required: ['query'],
      },
      brandRegistry,
      logger,
    );
  }

  protected async executeInternal(params: SearchArticlesParams): Promise<unknown> {
    const configured = this.brands.list().map((b) => b.subdomain);

    const requestedBrands = params.brands?.length
      ? params.brands.filter((b) => this.brands.hasBrand(b))
      : configured;

    if (requestedBrands.length === 0) {
      return {
        error: `No valid brands to search. Configured brands: ${configured.join(', ')}`,
      };
    }

    const perPage = params.per_page ?? DEFAULT_PER_PAGE;
    const page = params.page ?? 1;

    const queryParams: Record<string, string | number> = {
      query: params.query,
      per_page: perPage,
    };
    if (params.locale) queryParams.locale = params.locale;
    if (params.category !== undefined) queryParams.category = params.category;
    if (params.section !== undefined) queryParams.section = params.section;
    if (params.label_names) queryParams.label_names = params.label_names;

    const perBrand = await Promise.all(
      requestedBrands.map(async (brandSubdomain) => {
        const client = this.brands.getClient(brandSubdomain);
        const response = await runSearch(client, queryParams);
        return {
          brand: brandSubdomain,
          count: response.count,
          hasMore: !!response.next_page,
          tagged: response.results.map((a) => ({ brand: brandSubdomain, article: a })),
        };
      }),
    );

    const merged: TaggedResult[] = perBrand.flatMap((b) => b.tagged);
    merged.sort(
      (a, b) => new Date(b.article.updated_at).getTime() - new Date(a.article.updated_at).getTime(),
    );

    const start = (page - 1) * perPage;
    const paged = merged.slice(start, start + perPage);

    return {
      query: params.query,
      brands_searched: requestedBrands,
      total_matches: perBrand.reduce((s, b) => s + b.count, 0),
      matches_by_brand: Object.fromEntries(perBrand.map((b) => [b.brand, b.count])),
      any_brand_has_more: perBrand.some((b) => b.hasMore),
      page,
      per_page: perPage,
      has_more: start + perPage < merged.length,
      results: paged.map(({ brand, article: a }) => ({
        id: a.id,
        brand,
        title: a.title,
        url: a.html_url,
        locale: a.locale,
        section_id: a.section_id,
        labels: a.label_names ?? [],
        snippet: stripHtmlSnippet(a.body, 200),
        updated_at: a.updated_at,
      })),
    };
  }
}

async function runSearch(
  client: ZendeskAPIClient,
  queryParams: Record<string, string | number>,
): Promise<SearchArticlesResponse> {
  return client.get<SearchArticlesResponse>('/help_center/articles/search.json', queryParams);
}

function stripHtmlSnippet(html: string | null | undefined, maxLen: number): string {
  if (!html) return '';
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}
