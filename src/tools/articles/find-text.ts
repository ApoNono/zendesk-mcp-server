import { load as loadHTML } from 'cheerio';
import { MultiBrandTool } from '../multi-brand-base.js';
import { BrandRegistry, ZendeskAPIClient, ZendeskArticle } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface FindTextParams {
  query: string;
  brands?: string[];
  case_insensitive?: boolean;
  per_page?: number;
  page?: number;
}

interface ArticlesResponse {
  articles: ZendeskArticle[];
  next_page?: string | null;
}

interface Match {
  id: number;
  brand: string;
  title: string;
  url: string;
  title_matches: number;
  body_matches: number;
  total_matches: number;
  snippet: string;
  updated_at: string;
}

const MAX_ARTICLES_PER_BRAND = 5000;
const MIN_QUERY_LENGTH = 2;

export class FindTextInArticlesTool extends MultiBrandTool<FindTextParams> {
  constructor(brandRegistry: BrandRegistry, logger: Logger) {
    super(
      'zd_articles_find_text',
      'Find articles containing a specific plain-text string across one or more brands. HTML-safe — only searches human-readable text (never URLs, class names, or code blocks). Returns per-article match count + brand + URL + snippet. Use this as the discovery step before zd_articles_replace_text.',
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Plain-text string to search for (regex not supported).',
            minLength: MIN_QUERY_LENGTH,
          },
          brands: {
            type: 'array',
            items: { type: 'string' },
            description: 'Brand subdomains to search. Omit to search every configured brand.',
          },
          case_insensitive: {
            type: 'boolean',
            default: true,
            description: 'Match regardless of case (default true).',
          },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          page: { type: 'integer', minimum: 1, default: 1 },
        },
        required: ['query'],
      },
      brandRegistry,
      logger,
    );
  }

  protected async executeInternal(params: FindTextParams): Promise<unknown> {
    const requestedBrands = params.brands?.length
      ? params.brands.filter((b) => this.brands.hasBrand(b))
      : this.brands.list().map((b) => b.subdomain);

    if (requestedBrands.length === 0) {
      return {
        error:
          'No valid brands to search. Configured brands: ' +
          this.brands
            .list()
            .map((b) => b.subdomain)
            .join(', '),
      };
    }

    const caseInsensitive = params.case_insensitive !== false;
    const query = caseInsensitive ? params.query.toLowerCase() : params.query;
    const perPage = params.per_page ?? 50;
    const page = params.page ?? 1;

    const allMatches: Match[] = [];
    const brandsTruncated: string[] = [];

    for (const brandSubdomain of requestedBrands) {
      const client = this.brands.getClient(brandSubdomain);
      const articles = await fetchAllArticles(client, MAX_ARTICLES_PER_BRAND);
      if (articles.length === MAX_ARTICLES_PER_BRAND) brandsTruncated.push(brandSubdomain);

      for (const article of articles) {
        const titleHits = countMatches(article.title, query, caseInsensitive);
        const bodyText = stripHTMLToText(article.body ?? '');
        const bodyHits = countMatches(bodyText, query, caseInsensitive);
        if (titleHits + bodyHits === 0) continue;

        allMatches.push({
          id: article.id,
          brand: brandSubdomain,
          title: article.title,
          url: article.html_url,
          title_matches: titleHits,
          body_matches: bodyHits,
          total_matches: titleHits + bodyHits,
          snippet: snippetAround(bodyText || article.title, params.query, caseInsensitive),
          updated_at: article.updated_at,
        });
      }
    }

    // Sort by total matches desc so highest-signal results come first.
    allMatches.sort((a, b) => b.total_matches - a.total_matches);

    const start = (page - 1) * perPage;
    const paged = allMatches.slice(start, start + perPage);

    return {
      query: params.query,
      case_insensitive: caseInsensitive,
      brands_searched: requestedBrands,
      brands_truncated: brandsTruncated,
      articles_matched: allMatches.length,
      total_matches: allMatches.reduce((s, m) => s + m.total_matches, 0),
      page,
      per_page: perPage,
      has_more: start + perPage < allMatches.length,
      results: paged,
    };
  }
}

async function fetchAllArticles(client: ZendeskAPIClient, cap: number): Promise<ZendeskArticle[]> {
  const all: ZendeskArticle[] = [];
  let url: string | null = '/help_center/articles.json?per_page=100';
  while (url && all.length < cap) {
    const resp: ArticlesResponse = await client.get<ArticlesResponse>(url);
    all.push(...resp.articles);
    url = resp.next_page ? resp.next_page.replace(/^.*\/api\/v2/, '') : null;
  }
  return all;
}

function stripHTMLToText(html: string): string {
  if (!html) return '';
  const $ = loadHTML(html, { xmlMode: false }, false);
  // Remove code and pre blocks — searching inside code is usually not
  // desirable for content-management workflows.
  $('code, pre, script, style').remove();
  return $.text().replace(/\s+/g, ' ').trim();
}

function countMatches(haystack: string, needle: string, caseInsensitive: boolean): number {
  if (!haystack || !needle) return 0;
  const source = caseInsensitive ? haystack.toLowerCase() : haystack;
  let count = 0;
  let idx = source.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = source.indexOf(needle, idx + needle.length);
  }
  return count;
}

function snippetAround(
  text: string,
  needle: string,
  caseInsensitive: boolean,
  context = 60,
): string {
  if (!text) return '';
  const searchIn = caseInsensitive ? text.toLowerCase() : text;
  const searchFor = caseInsensitive ? needle.toLowerCase() : needle;
  const idx = searchIn.indexOf(searchFor);
  if (idx === -1) return text.slice(0, 120) + (text.length > 120 ? '…' : '');
  const start = Math.max(0, idx - context);
  const end = Math.min(text.length, idx + needle.length + context);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}
