#!/usr/bin/env node
/**
 * One-off content migration: find and replace text across Zendesk Help
 * Center articles, scoped to specific brands by their subdomain.
 * HTML-safe (only touches text nodes; never URLs, class names, or code blocks).
 *
 * Usage:
 *   npx tsx scripts/replace-text-in-articles.ts            # dry-run (default)
 *   npx tsx scripts/replace-text-in-articles.ts --apply    # actually write changes
 *
 * Auth: reads ZENDESK_EMAIL, ZENDESK_API_TOKEN from .env (same as the MCP
 * server). ZENDESK_SUBDOMAIN is NOT used here — brand subdomains are
 * configured in the BRANDS array below.
 *
 * Output: writes a timestamped markdown report listing every article
 * touched, with before/after snippets — share this with whoever is
 * verifying the changes.
 */
import { config as loadDotenv } from 'dotenv';
import axios, { AxiosInstance } from 'axios';
import { load as loadHTML } from 'cheerio';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

loadDotenv();

// ─── Configuration ──────────────────────────────────────────────────────────

interface BrandConfig {
  id: number;
  subdomain: string;
  name: string;
}

const BRANDS: BrandConfig[] = [
  { id: 30766836731661, subdomain: 'help-admin', name: 'Unifyr Admin' },
  { id: 45110535922701, subdomain: 'help-partners', name: 'Unifyr Partner' },
];

// Single regex catches all three variants ("Unifyr One", "UnifyrOne",
// "UnifyrONE") case-insensitively. The \s* eats any whitespace between
// "Unifyr" and "One" so the replacement leaves clean spacing.
const PATTERN = /Unifyr\s*One/gi;
const REPLACEMENT = 'Unifyr';

const DRY_RUN = !process.argv.includes('--apply');

// Optional: restrict to a single article ID for testing. Pass
// --only-article-id=NNN on the CLI.
const ONLY_ARTICLE_ID = (() => {
  const arg = process.argv.find((a) => a.startsWith('--only-article-id='));
  if (!arg) return null;
  const id = Number(arg.split('=')[1]);
  if (!Number.isFinite(id)) {
    console.error('Invalid --only-article-id value');
    process.exit(1);
  }
  return id;
})();

// ─── Types ──────────────────────────────────────────────────────────────────

interface ZendeskArticle {
  id: number;
  url: string;
  html_url: string;
  title: string;
  body?: string | null;
  locale: string;
  section_id: number | null;
  updated_at: string;
}

interface ZendeskTranslation {
  id: number;
  source_id: number;
  source_type: string;
  locale: string;
  title: string;
  body: string;
  updated_at: string;
}

interface ArticlesPage {
  articles: ZendeskArticle[];
  next_page?: string | null;
  count?: number;
}

interface TranslationsPage {
  translations: ZendeskTranslation[];
  next_page?: string | null;
}

interface Change {
  articleId: number;
  articleUrl: string;
  articleTitle: string;
  brandName: string;
  brandSubdomain: string;
  locale: string;
  bodyMatches: number;
  titleMatches: number;
  beforeTitle: string;
  afterTitle: string;
  beforeBodySnippet: string;
  afterBodySnippet: string;
}

// ─── Auth + HTTP per brand ─────────────────────────────────────────────────

function clientForBrand(subdomain: string): AxiosInstance {
  const email = required('ZENDESK_EMAIL');
  const apiToken = required('ZENDESK_API_TOKEN');
  const encoded = Buffer.from(`${email}/token:${apiToken}`).toString('base64');

  return axios.create({
    baseURL: `https://${subdomain}.zendesk.com/api/v2`,
    headers: {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    timeout: 30000,
  });
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}. Set it in .env`);
    process.exit(1);
  }
  return v;
}

// ─── Core: HTML-safe replacement ────────────────────────────────────────────

/**
 * Walk text nodes only; leave HTML attributes, URLs, classes, and code
 * blocks alone. Returns the new HTML and the number of replacements.
 */
function replaceInHTML(html: string): { html: string; matches: number } {
  if (!html) return { html, matches: 0 };

  const $ = loadHTML(html, { xmlMode: false }, false);
  let matches = 0;

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
      const matchCount = (original.match(PATTERN) || []).length;
      if (matchCount === 0) return;
      let replaced = original.replace(PATTERN, REPLACEMENT);
      replaced = replaced.replace(/ {2,}/g, ' ');
      node.data = replaced;
      matches += matchCount;
    });

  return { html: $.html(), matches };
}

/**
 * Replace in plain text (used for article titles). Same regex as the
 * body replacer, then collapse any double spaces.
 */
function replaceInText(text: string): { text: string; matches: number } {
  if (!text) return { text, matches: 0 };
  const matchCount = (text.match(PATTERN) || []).length;
  if (matchCount === 0) return { text, matches: 0 };
  const replaced = text.replace(PATTERN, REPLACEMENT).replace(/ {2,}/g, ' ');
  return { text: replaced, matches: matchCount };
}

function snippetAround(text: string, pattern: RegExp, context = 60): string {
  if (!text) return '';
  const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const match = stripped.match(pattern);
  if (!match || match.index === undefined) return stripped.slice(0, 120) + '…';
  const start = Math.max(0, match.index - context);
  const end = Math.min(stripped.length, match.index + match[0].length + context);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < stripped.length ? '…' : '';
  return prefix + stripped.slice(start, end) + suffix;
}

// ─── Zendesk API helpers ────────────────────────────────────────────────────

async function listAllArticles(http: AxiosInstance, brandLabel: string): Promise<ZendeskArticle[]> {
  const all: ZendeskArticle[] = [];
  let url: string | null = '/help_center/articles.json?per_page=100';
  let page = 0;
  while (url) {
    page++;
    process.stdout.write(
      `\r  [${brandLabel}] fetching articles… page ${page} (${all.length} so far)`,
    );
    const resp = await http.get<ArticlesPage>(url);
    all.push(...resp.data.articles);
    url = resp.data.next_page ? resp.data.next_page.replace(/^.*\/api\/v2/, '') : null;
  }
  process.stdout.write('\n');
  return all;
}

async function getTranslations(
  http: AxiosInstance,
  articleId: number,
): Promise<ZendeskTranslation[]> {
  const all: ZendeskTranslation[] = [];
  let url: string | null = `/help_center/articles/${articleId}/translations.json`;
  while (url) {
    const resp = await http.get<TranslationsPage>(url);
    all.push(...resp.data.translations);
    url = resp.data.next_page ? resp.data.next_page.replace(/^.*\/api\/v2/, '') : null;
  }
  return all;
}

async function updateTranslation(
  http: AxiosInstance,
  articleId: number,
  locale: string,
  updates: { title?: string; body?: string },
): Promise<void> {
  // Only send fields we actually want to change — minimizes risk of
  // accidentally clobbering anything.
  const payload: Record<string, string> = {};
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.body !== undefined) payload.body = updates.body;
  await http.put(`/help_center/articles/${articleId}/translations/${locale}.json`, {
    translation: payload,
  });
}

// ─── Report ─────────────────────────────────────────────────────────────────

function renderReport(changes: Change[], applied: boolean): string {
  const timestamp = new Date().toISOString();
  const totalBody = changes.reduce((s, c) => s + c.bodyMatches, 0);
  const totalTitle = changes.reduce((s, c) => s + c.titleMatches, 0);
  const titleChangeCount = changes.filter((c) => c.titleMatches > 0).length;
  const uniqueArticles = new Set(changes.map((c) => c.articleId)).size;

  let md = `# Zendesk article text replacement report\n\n`;
  md += `**Generated**: ${timestamp}\n`;
  md += `**Mode**: ${applied ? '✅ APPLIED' : '🔍 DRY-RUN (no changes written)'}\n`;
  md += `**Pattern**: \`${PATTERN.source}\` → \`${REPLACEMENT}\`\n`;
  md += `**Brands**: ${BRANDS.map((b) => `${b.name} (${b.subdomain})`).join(', ')}\n\n`;
  md += `**Summary**: ${uniqueArticles} articles touched across ${changes.length} translation(s). `;
  md += `${totalBody} body replacements, ${totalTitle} title replacements (${titleChangeCount} translations had title changes).\n\n`;
  md += `---\n\n`;

  for (const brand of BRANDS) {
    const brandChanges = changes.filter((c) => c.brandSubdomain === brand.subdomain);
    if (brandChanges.length === 0) continue;

    const brandArticleCount = new Set(brandChanges.map((c) => c.articleId)).size;
    const brandBodyMatches = brandChanges.reduce((s, c) => s + c.bodyMatches, 0);
    const brandTitleMatches = brandChanges.reduce((s, c) => s + c.titleMatches, 0);
    md += `## ${brand.name} (\`${brand.subdomain}\`)\n\n`;
    md += `_${brandArticleCount} articles · ${brandBodyMatches} body replacements · ${brandTitleMatches} title replacements_\n\n`;

    const byArticle = new Map<number, Change[]>();
    for (const c of brandChanges) {
      if (!byArticle.has(c.articleId)) byArticle.set(c.articleId, []);
      byArticle.get(c.articleId)!.push(c);
    }

    for (const [articleId, articleChanges] of byArticle) {
      const first = articleChanges[0];
      const totalBodyForArticle = articleChanges.reduce((s, c) => s + c.bodyMatches, 0);
      const totalTitleForArticle = articleChanges.reduce((s, c) => s + c.titleMatches, 0);
      md += `### [${first.articleTitle}](${first.articleUrl})\n\n`;
      md += `- **Article ID**: ${articleId}\n`;
      md += `- **URL**: ${first.articleUrl}\n`;
      md += `- **Locales touched**: ${articleChanges.map((c) => c.locale).join(', ')}\n`;
      md += `- **Body replacements**: ${totalBodyForArticle}\n`;
      md += `- **Title replacements**: ${totalTitleForArticle}\n\n`;
      for (const c of articleChanges) {
        md += `#### \`${c.locale}\`\n\n`;
        if (c.titleMatches > 0) {
          md += `**Title change** (${c.titleMatches}):\n`;
          md += `- Before: \`${c.beforeTitle}\`\n`;
          md += `- After: \`${c.afterTitle}\`\n\n`;
        }
        if (c.bodyMatches > 0) {
          md += `**Body changes** (${c.bodyMatches}):\n`;
          md += `- Before: ${c.beforeBodySnippet}\n`;
          md += `- After: ${c.afterBodySnippet}\n\n`;
        }
      }
      md += `---\n\n`;
    }
  }

  return md;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY-RUN' : '⚠️  APPLY (will write changes)'}`);
  if (ONLY_ARTICLE_ID !== null) {
    console.log(`🎯 Targeted mode: article ${ONLY_ARTICLE_ID} only`);
  }
  console.log(`Brands:`);
  for (const b of BRANDS) console.log(`  - ${b.name} (${b.subdomain})`);
  console.log(`Pattern: ${PATTERN.source} → "${REPLACEMENT}"`);
  console.log();

  const changes: Change[] = [];

  for (const brand of BRANDS) {
    console.log(`\n=== ${brand.name} (${brand.subdomain}) ===`);
    const http = clientForBrand(brand.subdomain);

    let articles: ZendeskArticle[];
    try {
      if (ONLY_ARTICLE_ID !== null) {
        // Targeted mode: fetch just the one article from this brand.
        // 404 means it's not in this brand; that's fine, move on.
        try {
          const resp = await http.get<{ article: ZendeskArticle }>(
            `/help_center/articles/${ONLY_ARTICLE_ID}.json`,
          );
          articles = [resp.data.article];
          console.log(`  Targeted mode: article ${ONLY_ARTICLE_ID} found in this brand.`);
        } catch (err: unknown) {
          const status = (err as { response?: { status: number } }).response?.status;
          if (status === 404) {
            console.log(`  Targeted mode: article ${ONLY_ARTICLE_ID} not in this brand, skipping.`);
            continue;
          }
          throw err;
        }
      } else {
        articles = await listAllArticles(http, brand.subdomain);
      }
    } catch (err) {
      console.error(`  ✗ Failed to list articles for ${brand.subdomain}:`, (err as Error).message);
      continue;
    }
    console.log(`  Found ${articles.length} articles.`);

    let processed = 0;
    for (const article of articles) {
      processed++;
      if (processed % 10 === 0 || processed === articles.length) {
        process.stdout.write(
          `\r  scanning ${processed}/${articles.length} (${changes.length} changes so far)`,
        );
      }

      let translations: ZendeskTranslation[];
      try {
        translations = await getTranslations(http, article.id);
      } catch (err) {
        console.error(
          `\n  ✗ Failed to fetch translations for article ${article.id}:`,
          (err as Error).message,
        );
        continue;
      }

      for (const t of translations) {
        const { html: newBody, matches: bodyMatches } = replaceInHTML(t.body);
        const { text: newTitle, matches: titleMatches } = replaceInText(t.title);
        if (bodyMatches === 0 && titleMatches === 0) continue;

        changes.push({
          articleId: article.id,
          articleUrl: article.html_url,
          articleTitle: article.title,
          brandName: brand.name,
          brandSubdomain: brand.subdomain,
          locale: t.locale,
          bodyMatches,
          titleMatches,
          beforeTitle: t.title,
          afterTitle: newTitle,
          beforeBodySnippet:
            bodyMatches > 0 ? snippetAround(t.body, PATTERN) : '(no change)',
          afterBodySnippet:
            bodyMatches > 0 ? snippetAround(newBody, new RegExp(REPLACEMENT, 'gi')) : '(no change)',
        });

        if (!DRY_RUN) {
          try {
            const updates: { title?: string; body?: string } = {};
            if (titleMatches > 0) updates.title = newTitle;
            if (bodyMatches > 0) updates.body = newBody;
            await updateTranslation(http, article.id, t.locale, updates);
          } catch (err) {
            console.error(
              `\n  ✗ Failed to update article ${article.id} (${t.locale}):`,
              (err as Error).message,
            );
          }
        }
      }
    }
    process.stdout.write('\n');
  }

  console.log('\n');
  const report = renderReport(changes, !DRY_RUN);
  const reportPath = resolve(
    process.cwd(),
    `replacement-report-${DRY_RUN ? 'dryrun-' : ''}${Date.now()}.md`,
  );
  writeFileSync(reportPath, report);

  const totalBody = changes.reduce((s, c) => s + c.bodyMatches, 0);
  const totalTitle = changes.reduce((s, c) => s + c.titleMatches, 0);
  const titleChangeCount = changes.filter((c) => c.titleMatches > 0).length;
  console.log(`Done.`);
  console.log(`  Articles changed:    ${new Set(changes.map((c) => c.articleId)).size}`);
  console.log(`  Translation edits:   ${changes.length}`);
  console.log(`  Body replacements:   ${totalBody}`);
  console.log(`  Title replacements:  ${totalTitle} (${titleChangeCount} translation titles changed)`);
  console.log(`  Report: ${reportPath}`);
  if (DRY_RUN) {
    console.log();
    console.log(`This was a dry-run. To apply changes, re-run with --apply.`);
  }
}

main().catch((err) => {
  console.error('\n💥 Script failed:', err.message);
  if (err.response) {
    console.error('   API status:', err.response.status);
    console.error('   API body:', JSON.stringify(err.response.data, null, 2).slice(0, 500));
  }
  process.exit(1);
});
