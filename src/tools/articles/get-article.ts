import { BaseTool } from '../base.js';
import { ZendeskAPIClient, ZendeskArticle } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface GetArticleParams {
  id: number;
  locale?: string;
}

interface GetArticleResponse {
  article: ZendeskArticle;
}

export class GetArticleTool extends BaseTool<GetArticleParams> {
  constructor(apiClient: ZendeskAPIClient, logger: Logger) {
    super(
      'zd_article_get',
      'Get the full body of a Help Center article by ID.',
      {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Article ID' },
          locale: {
            type: 'string',
            description: 'Locale variant to fetch (e.g. "en-us"). Optional.',
          },
        },
        required: ['id'],
      },
      apiClient,
      logger,
    );
  }

  protected async executeInternal(params: GetArticleParams): Promise<unknown> {
    const path = params.locale
      ? `/help_center/${encodeURIComponent(params.locale)}/articles/${params.id}.json`
      : `/help_center/articles/${params.id}.json`;

    const response = await this.apiClient.get<GetArticleResponse>(path);
    const a = response.article;

    return {
      id: a.id,
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
