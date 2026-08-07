import { MultiBrandTool } from '../multi-brand-base.js';
import { BrandRegistry, ZendeskArticle } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface UpdateArticleParams {
  id: number;
  brand: string;
  locale?: string;
  title?: string;
  body?: string;
  label_names?: string[];
  section_id?: number;
  draft?: boolean;
  promoted?: boolean;
  outdated?: boolean;
  update_reason?: string;
}

interface ArticleResponse {
  article: ZendeskArticle;
}

const DEFAULT_LOCALE = 'en-us';

/**
 * First write tool. Updates a single article in a specific brand's Help
 * Center. Only sends fields that were explicitly provided — nothing is
 * clobbered by omission. Zendesk splits article metadata (section, state)
 * from translation content (title, body) across two endpoints, so this
 * tool routes changes to the right one internally.
 */
export class UpdateArticleTool extends MultiBrandTool<UpdateArticleParams> {
  constructor(brandRegistry: BrandRegistry, logger: Logger) {
    super(
      'zd_article_update',
      "Update a single Help Center article's title, body, labels, section, or draft/promoted/outdated state. Only the fields you pass are changed — nothing else is touched. Use `update_reason` to leave an audit trail (echoed back in the response, useful for logging in Confluence/Slack).",
      {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Article ID' },
          brand: {
            type: 'string',
            description: "Brand subdomain (e.g. 'help-admin') that hosts the article.",
          },
          locale: {
            type: 'string',
            default: DEFAULT_LOCALE,
            description: "Translation locale to update. Defaults to 'en-us'.",
          },
          title: {
            type: 'string',
            description: 'New title for the article translation',
          },
          body: {
            type: 'string',
            description: 'New body (HTML) for the article translation',
          },
          label_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Replaces the article label list',
          },
          section_id: {
            type: 'integer',
            description: 'Move the article to this section',
          },
          draft: { type: 'boolean', description: 'Set draft state' },
          promoted: { type: 'boolean', description: 'Set promoted state' },
          outdated: { type: 'boolean', description: 'Flag article as outdated' },
          update_reason: {
            type: 'string',
            description:
              'Free-text note describing why this update is being made. Echoed in the response for audit trails; not stored in Zendesk.',
          },
        },
        required: ['id', 'brand'],
      },
      brandRegistry,
      logger,
    );
  }

  protected async executeInternal(params: UpdateArticleParams): Promise<unknown> {
    if (!this.brands.hasBrand(params.brand)) {
      return {
        error: `Brand '${params.brand}' is not configured. Configured brands: ${this.brands
          .list()
          .map((b) => b.subdomain)
          .join(', ')}`,
      };
    }

    // Nothing to update?
    const hasTranslationChange = params.title !== undefined || params.body !== undefined;
    const hasArticleChange =
      params.label_names !== undefined ||
      params.section_id !== undefined ||
      params.draft !== undefined ||
      params.promoted !== undefined ||
      params.outdated !== undefined;

    if (!hasTranslationChange && !hasArticleChange) {
      return {
        error:
          'No update fields provided. Pass at least one of: title, body, label_names, section_id, draft, promoted, outdated.',
      };
    }

    const client = this.brands.getClient(params.brand);
    const locale = params.locale ?? DEFAULT_LOCALE;
    const changed: string[] = [];

    // Translation update (title + body live on the translation)
    if (hasTranslationChange) {
      const translationPayload: Record<string, unknown> = {};
      if (params.title !== undefined) {
        translationPayload.title = params.title;
        changed.push('title');
      }
      if (params.body !== undefined) {
        translationPayload.body = params.body;
        changed.push('body');
      }
      await client.put(`/help_center/articles/${params.id}/translations/${locale}.json`, {
        translation: translationPayload,
      });
    }

    // Article-level metadata (section, labels, state)
    if (hasArticleChange) {
      const articlePayload: Record<string, unknown> = {};
      if (params.label_names !== undefined) {
        articlePayload.label_names = params.label_names;
        changed.push('label_names');
      }
      if (params.section_id !== undefined) {
        articlePayload.section_id = params.section_id;
        changed.push('section_id');
      }
      if (params.draft !== undefined) {
        articlePayload.draft = params.draft;
        changed.push('draft');
      }
      if (params.promoted !== undefined) {
        articlePayload.promoted = params.promoted;
        changed.push('promoted');
      }
      if (params.outdated !== undefined) {
        articlePayload.outdated = params.outdated;
        changed.push('outdated');
      }
      await client.put(`/help_center/articles/${params.id}.json`, {
        article: articlePayload,
      });
    }

    // Fetch the final state to return.
    const resp = await client.get<ArticleResponse>(`/help_center/articles/${params.id}.json`);
    const a = resp.article;

    return {
      success: true,
      id: a.id,
      brand: params.brand,
      locale,
      title: a.title,
      url: a.html_url,
      section_id: a.section_id,
      draft: a.draft,
      promoted: a.promoted,
      outdated: a.outdated,
      labels: a.label_names ?? [],
      updated_at: a.updated_at,
      changed_fields: changed,
      update_reason: params.update_reason,
    };
  }
}
