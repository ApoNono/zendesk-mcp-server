import { BaseTool } from '../base.js';
import { ZendeskAPIClient, ZendeskArticle } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface SearchArticlesParams {
  query: string;
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

export class SearchArticlesTool extends BaseTool<SearchArticlesParams> {
  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_article_search',
      'Search Help Center articles by keyword. Returns matching articles with title, snippet, and URL.',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (required)',
            minLength: 1,
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
            maximum: 100,
            default: 25,
          },
          page: {
            type: 'integer',
            minimum: 1,
            default: 1,
          },
        },
        required: ['query'],
      },
      apiClient,
      logger,
    );
  }

  protected async executeInternal(params: SearchArticlesParams): Promise<unknown> {
    const queryParams: Record<string, string | number> = {
      query: params.query,
      per_page: params.per_page ?? 25,
      page: params.page ?? 1,
    };
    if (params.locale) queryParams.locale = params.locale;
    if (params.category !== undefined) queryParams.category = params.category;
    if (params.section !== undefined) queryParams.section = params.section;
    if (params.label_names) queryParams.label_names = params.label_names;

    const response = await this.apiClient.get<SearchArticlesResponse>(
      '/help_center/articles/search.json',
      queryParams,
    );

    return {
      count: response.count,
      page: response.page,
      per_page: response.per_page,
      has_more: !!response.next_page,
      results: response.results.map((a) => ({
        id: a.id,
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
