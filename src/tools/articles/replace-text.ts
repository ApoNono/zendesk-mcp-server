import { load as loadHTML } from 'cheerio';
import { MultiBrandTool } from '../multi-brand-base.js';
import { BrandRegistry } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface ReplaceTextParams {
  find: string;
  replace_with: string;
  brand: string;
  article_ids: number[];
  locale?: string;
  case_insensitive?: boolean;
  update_reason?: string;
}

interface Translation {
  locale: string;
  title: string;
  body: string;
}
interface TranslationResponse {
  translation: Translation;
}
const MAX_ARTICLES_PER_CALL = 100;
const DEFAULT_LOCALE = 'en-us';

/**
 * Second write tool. Applies a plain-string find/replace to a specific list
 * of article IDs within a single brand. Deliberately not regex — regex power
 * is available via the scripts/replace-text-in-articles.ts one-off tool for
 * complex cases. Deliberately requires an explicit article ID list from
 * zd_articles_find_text — no "replace across everything matching" convenience.
 */
export class ReplaceTextInArticlesTool extends MultiBrandTool<ReplaceTextParams> {
  constructor(brandRegistry: BrandRegistry, logger: Logger) {
    super(
      'zd_articles_replace_text',
      'Apply a plain-string find/replace to the titles and bodies of a specific list of article IDs within one brand. HTML-safe (body replacement walks text nodes only). Regex is NOT supported — for regex, use scripts/replace-text-in-articles.ts. First use zd_articles_find_text to discover which articles need updating, then pass the approved subset here.',
      {
        type: 'object',
        properties: {
          find: {
            type: 'string',
            description: 'Plain text to search for (regex not supported).',
            minLength: 1,
          },
          replace_with: {
            type: 'string',
            description: 'Replacement text. Can be empty to delete matches.',
          },
          brand: {
            type: 'string',
            description: "Brand subdomain that hosts the articles (e.g. 'help-admin').",
          },
          article_ids: {
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: MAX_ARTICLES_PER_CALL,
            description: `Explicit list of article IDs to update. Max ${MAX_ARTICLES_PER_CALL} per call. Get these from zd_articles_find_text.`,
          },
          locale: {
            type: 'string',
            default: DEFAULT_LOCALE,
            description: "Translation locale to update. Defaults to 'en-us'.",
          },
          case_insensitive: {
            type: 'boolean',
            default: true,
            description: 'Match regardless of case (default true).',
          },
          update_reason: {
            type: 'string',
            description: 'Free-text note for the audit trail (echoed in response).',
          },
        },
        required: ['find', 'replace_with', 'brand', 'article_ids'],
      },
      brandRegistry,
      logger,
    );
  }

  protected async executeInternal(params: ReplaceTextParams): Promise<unknown> {
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
    const caseInsensitive = params.case_insensitive !== false;

    const results: Array<{
      id: number;
      title?: string;
      url?: string;
      title_replacements: number;
      body_replacements: number;
      before_title?: string;
      after_title?: string;
      snippet_before?: string;
      snippet_after?: string;
      skipped: boolean;
      error?: string;
    }> = [];

    for (const id of params.article_ids) {
      try {
        // Fetch the translation for this locale
        const resp = await client.get<TranslationResponse>(
          `/help_center/articles/${id}/translations/${locale}.json`,
        );
        const t = resp.translation;
        const originalTitle = t.title;
        const originalBody = t.body;

        const { text: newTitle, count: titleCount } = replaceInText(
          originalTitle,
          params.find,
          params.replace_with,
          caseInsensitive,
        );
        const { html: newBody, count: bodyCount } = replaceInHTML(
          originalBody,
          params.find,
          params.replace_with,
          caseInsensitive,
        );

        if (titleCount === 0 && bodyCount === 0) {
          results.push({
            id,
            title: originalTitle,
            title_replacements: 0,
            body_replacements: 0,
            skipped: true,
          });
          continue;
        }

        // PUT only the fields that actually changed.
        const payload: Record<string, unknown> = {};
        if (titleCount > 0) payload.title = newTitle;
        if (bodyCount > 0) payload.body = newBody;
        await client.put(`/help_center/articles/${id}/translations/${locale}.json`, {
          translation: payload,
        });

        // Fetch article to get the html_url for the response.
        const articleResp = await client.get<{ article: { html_url: string } }>(
          `/help_center/articles/${id}.json`,
        );

        results.push({
          id,
          title: newTitle,
          url: articleResp.article.html_url,
          title_replacements: titleCount,
          body_replacements: bodyCount,
          before_title: titleCount > 0 ? originalTitle : undefined,
          after_title: titleCount > 0 ? newTitle : undefined,
          snippet_before:
            bodyCount > 0 ? snippetAround(originalBody, params.find, caseInsensitive) : undefined,
          snippet_after:
            bodyCount > 0
              ? snippetAround(newBody, params.replace_with || params.find, caseInsensitive)
              : undefined,
          skipped: false,
        });
      } catch (error) {
        results.push({
          id,
          title_replacements: 0,
          body_replacements: 0,
          skipped: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const applied = results.filter((r) => !r.skipped && !r.error).length;
    const skipped = results.filter((r) => r.skipped).length;
    const errors = results.filter((r) => r.error).length;
    const totalTitle = results.reduce((s, r) => s + r.title_replacements, 0);
    const totalBody = results.reduce((s, r) => s + r.body_replacements, 0);

    return {
      brand: params.brand,
      locale,
      find: params.find,
      replace_with: params.replace_with,
      case_insensitive: caseInsensitive,
      articles_processed: results.length,
      articles_updated: applied,
      articles_skipped: skipped,
      articles_errored: errors,
      total_title_replacements: totalTitle,
      total_body_replacements: totalBody,
      update_reason: params.update_reason,
      results,
    };
  }
}

function replaceInText(
  text: string,
  find: string,
  replaceWith: string,
  caseInsensitive: boolean,
): { text: string; count: number } {
  if (!text || !find) return { text, count: 0 };
  const flags = caseInsensitive ? 'gi' : 'g';
  const pattern = new RegExp(escapeRegExp(find), flags);
  const matches = text.match(pattern);
  if (!matches) return { text, count: 0 };
  return {
    text: text.replace(pattern, replaceWith).replace(/ {2,}/g, ' '),
    count: matches.length,
  };
}

function replaceInHTML(
  html: string,
  find: string,
  replaceWith: string,
  caseInsensitive: boolean,
): { html: string; count: number } {
  if (!html || !find) return { html, count: 0 };
  const $ = loadHTML(html, { xmlMode: false }, false);
  const flags = caseInsensitive ? 'gi' : 'g';
  const pattern = new RegExp(escapeRegExp(find), flags);
  let count = 0;

  $('*')
    .contents()
    .each((_, node) => {
      if (node.type !== 'text') return;
      const parent = node.parent;
      if (parent && parent.type === 'tag') {
        const tag = parent.name;
        if (tag === 'code' || tag === 'pre' || tag === 'script' || tag === 'style') return;
      }
      const original = node.data ?? '';
      const matches = original.match(pattern);
      if (!matches) return;
      let replaced = original.replace(pattern, replaceWith);
      replaced = replaced.replace(/ {2,}/g, ' ');
      node.data = replaced;
      count += matches.length;
    });

  return { html: $.html(), count };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function snippetAround(
  htmlOrText: string,
  needle: string,
  caseInsensitive: boolean,
  context = 60,
): string {
  const text = htmlOrText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const searchIn = caseInsensitive ? text.toLowerCase() : text;
  const searchFor = caseInsensitive ? needle.toLowerCase() : needle;
  const idx = searchIn.indexOf(searchFor);
  if (idx === -1) return text.slice(0, 120) + (text.length > 120 ? '…' : '');
  const start = Math.max(0, idx - context);
  const end = Math.min(text.length, idx + needle.length + context);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}
