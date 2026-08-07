import { MultiBrandTool } from '../multi-brand-base.js';
import { BrandRegistry, ZendeskArticle } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface CreateArticleParams {
  brand: string;
  section_id: number;
  title: string;
  body: string;
  locale?: string;
  label_names?: string[];
  draft?: boolean;
  promoted?: boolean;
  permission_group_id?: number;
  user_segment_id?: number;
  author_id?: number;
  create_reason?: string;
}

interface CreateArticleResponse {
  article: ZendeskArticle;
}

const DEFAULT_LOCALE = 'en-us';

/**
 * Third write tool. Creates a new Help Center article in a specific
 * brand's help center, within an explicit section. Defaults to draft to
 * avoid accidentally publishing content the author hasn't reviewed yet.
 * Use zd_sections_list first to discover valid section IDs.
 */
export class CreateArticleTool extends MultiBrandTool<CreateArticleParams> {
  constructor(brandRegistry: BrandRegistry, logger: Logger) {
    super(
      'zd_article_create',
      "Create a new Help Center article in a specific brand's section. Defaults to `draft: true` for safety — pass `draft: false` explicitly to publish immediately. Use zd_sections_list first to discover valid section IDs. Note: in Zendesk Guide Professional/Enterprise, `permission_group_id` may be required — if the API returns a permission error, pass one.",
      {
        type: 'object',
        properties: {
          brand: {
            type: 'string',
            description: "Brand subdomain that will host the article (e.g. 'help-admin').",
          },
          section_id: {
            type: 'integer',
            description:
              'ID of the section to publish into. Get this from zd_sections_list — the section belongs to a category and both live inside a brand.',
          },
          title: {
            type: 'string',
            description: 'Article title',
            minLength: 1,
          },
          body: {
            type: 'string',
            description: 'Article body as HTML',
            minLength: 1,
          },
          locale: {
            type: 'string',
            default: DEFAULT_LOCALE,
            description: "Locale for the initial translation. Defaults to 'en-us'.",
          },
          label_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Labels to attach to the new article',
          },
          draft: {
            type: 'boolean',
            default: true,
            description:
              'Create as a draft (default true). Pass false to publish immediately — the article is visible to end-users right away.',
          },
          promoted: {
            type: 'boolean',
            default: false,
            description: 'Mark as promoted (surfaced at top of the section/category)',
          },
          permission_group_id: {
            type: 'integer',
            description:
              'Permission group ID controlling who can edit the article. Required in Zendesk Guide Professional/Enterprise plans.',
          },
          user_segment_id: {
            type: 'integer',
            description:
              'User segment ID for visibility restriction (Guide Professional/Enterprise). Omit for public articles.',
          },
          author_id: {
            type: 'integer',
            description:
              'Author user ID. Defaults to the authenticated user (the token owner) if omitted.',
          },
          create_reason: {
            type: 'string',
            description:
              'Free-text note describing why this article is being created. Echoed in the response for audit trails; not stored in Zendesk.',
          },
        },
        required: ['brand', 'section_id', 'title', 'body'],
      },
      brandRegistry,
      logger,
    );
  }

  protected async executeInternal(params: CreateArticleParams): Promise<unknown> {
    if (!this.brands.hasBrand(params.brand)) {
      return {
        error: `Brand '${params.brand}' is not configured. Configured brands: ${this.brands
          .list()
          .map((b) => b.subdomain)
          .join(', ')}`,
      };
    }

    const client = this.brands.getClient(params.brand);
    const locale = params.locale ?? DEFAULT_LOCALE;

    const articlePayload: Record<string, unknown> = {
      title: params.title,
      body: params.body,
      locale,
      draft: params.draft !== false,
      promoted: params.promoted === true,
    };
    if (params.label_names !== undefined) articlePayload.label_names = params.label_names;
    if (params.permission_group_id !== undefined)
      articlePayload.permission_group_id = params.permission_group_id;
    if (params.user_segment_id !== undefined)
      articlePayload.user_segment_id = params.user_segment_id;
    if (params.author_id !== undefined) articlePayload.author_id = params.author_id;

    const resp = await client.post<CreateArticleResponse>(
      `/help_center/sections/${params.section_id}/articles.json`,
      { article: articlePayload },
    );
    const a = resp.article;

    return {
      success: true,
      id: a.id,
      brand: params.brand,
      section_id: a.section_id,
      title: a.title,
      url: a.html_url,
      locale: a.locale,
      draft: a.draft,
      promoted: a.promoted,
      outdated: a.outdated,
      labels: a.label_names ?? [],
      created_at: a.created_at,
      updated_at: a.updated_at,
      create_reason: params.create_reason,
      note:
        a.draft === false
          ? 'Article is published and visible to end-users immediately.'
          : 'Article is a draft. Set draft: false via zd_article_update to publish.',
    };
  }
}
