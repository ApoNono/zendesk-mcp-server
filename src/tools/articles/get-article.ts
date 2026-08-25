import { MultiBrandTool } from '../multi-brand-base.js';
import { BrandRegistry, ZendeskArticle } from '../../api/index.js';
import { APINotFoundError } from '../../api/errors.js';
import { Logger } from '../../utils/logger.js';

interface GetArticleParams {
  id: number;
  brand?: string;
  locale?: string;
}

interface GetArticleResponse {
  article: ZendeskArticle;
}

export class GetArticleTool extends MultiBrandTool<GetArticleParams> {
  constructor(brandRegistry: BrandRegistry, logger: Logger) {
    super(
      'zd_article_get',
      'Get the full body of a Help Center article by ID. If `brand` is omitted, tries each configured brand in order and returns the first that has the article. Pass `brand` explicitly (usually taken from a prior search result) to skip the fallback and save round-trips.',
      {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Article ID' },
          brand: {
            type: 'string',
            description:
              'Brand subdomain (e.g. "help-admin"). Optional — when omitted, tries every configured brand until one returns the article.',
          },
          locale: {
            type: 'string',
            description: 'Locale variant to fetch (e.g. "en-us"). Optional.',
          },
        },
        required: ['id'],
      },
      brandRegistry,
      logger,
    );
  }

  protected async executeInternal(params: GetArticleParams): Promise<unknown> {
    if (params.brand && !this.brands.hasBrand(params.brand)) {
      return {
        error: `Brand '${params.brand}' is not configured. Configured brands: ${this.brands
          .list()
          .map((b) => b.subdomain)
          .join(', ')}`,
      };
    }

    const brandsToTry = params.brand
      ? [params.brand]
      : this.brands.list().map((b) => b.subdomain);

    const path = params.locale
      ? `/help_center/${encodeURIComponent(params.locale)}/articles/${params.id}.json`
      : `/help_center/articles/${params.id}.json`;

    const brandsSearched: string[] = [];
    for (const brandSubdomain of brandsToTry) {
      const client = this.brands.getClient(brandSubdomain);
      brandsSearched.push(brandSubdomain);
      try {
        const response = await client.get<GetArticleResponse>(path);
        const a = response.article;
        return {
          id: a.id,
          brand: brandSubdomain,
          title: a.title,
          url: a.html_url,
          locale: a.locale,
          section_id: a.section_id,
          labels: a.label_names ?? [],
          draft: a.draft,
          promoted: a.promoted,
          outdated: a.outdated,
          body_html: a.body ?? '',
          body_text: stripHtml(a.body),
          created_at: a.created_at,
          updated_at: a.updated_at,
        };
      } catch (err) {
        if (err instanceof APINotFoundError) continue;
        throw err;
      }
    }

    return {
      error: `Article ${params.id} not found in any configured brand`,
      brands_searched: brandsSearched,
    };
  }
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
