#!/usr/bin/env node
/**
 * Diagnostic: figure out how brands are exposed on articles in this
 * Zendesk Help Center. Run with: npx tsx scripts/diagnose-brands.ts
 */
import { config as loadDotenv } from 'dotenv';
import axios from 'axios';

loadDotenv();

const subdomain = process.env.ZENDESK_SUBDOMAIN!;
const email = process.env.ZENDESK_EMAIL!;
const apiToken = process.env.ZENDESK_API_TOKEN!;
const encoded = Buffer.from(`${email}/token:${apiToken}`).toString('base64');

const http = axios.create({
  baseURL: `https://${subdomain}.zendesk.com/api/v2`,
  headers: {
    Authorization: `Basic ${encoded}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 30000,
});

async function main() {
  console.log('1. Fetching brands…');
  const brandsResp = await http.get('/brands.json');
  const brands = brandsResp.data.brands;
  console.log(`   Found ${brands.length} brands:`);
  for (const b of brands) {
    console.log(`   - id=${b.id} subdomain=${b.subdomain} name=${b.name} active=${b.active}`);
  }
  console.log();

  console.log('2. Fetching first page of articles + inspecting first 3…');
  const articlesResp = await http.get('/help_center/articles.json?per_page=10');
  const articles = articlesResp.data.articles;
  console.log(`   Got ${articles.length} articles. Sample fields on first 3:`);
  for (const a of articles.slice(0, 3)) {
    const fields: Record<string, unknown> = {};
    for (const k of ['id', 'title', 'brand_id', 'section_id', 'locale', 'html_url']) {
      fields[k] = (a as Record<string, unknown>)[k];
    }
    console.log('   ', JSON.stringify(fields));
  }
  console.log();

  // Distinct brand_ids across the page
  const brandIdsSeen = new Set<string>();
  for (const a of articles) {
    brandIdsSeen.add(String((a as Record<string, unknown>).brand_id ?? 'undefined'));
  }
  console.log(`3. Distinct brand_id values on this page: ${[...brandIdsSeen].join(', ')}`);
  console.log();

  console.log('4. Fetching categories with their brand_ids…');
  const catsResp = await http.get('/help_center/categories.json?per_page=100');
  const cats = catsResp.data.categories;
  console.log(`   ${cats.length} categories. Distinct brand_ids on categories:`);
  const catBrandIds = new Set<string>();
  for (const c of cats) catBrandIds.add(String((c as Record<string, unknown>).brand_id ?? 'undefined'));
  console.log(`   ${[...catBrandIds].join(', ')}`);
  console.log();

  console.log('5. Trying a brand-scoped article fetch via brand subdomain…');
  // Try fetching via each brand's subdomain explicitly
  for (const b of brands) {
    if (!b.subdomain || !b.active) continue;
    try {
      const resp = await axios.get(
        `https://${b.subdomain}.zendesk.com/api/v2/help_center/articles.json?per_page=1`,
        { headers: { Authorization: `Basic ${encoded}`, Accept: 'application/json' }, timeout: 15000 },
      );
      console.log(`   ${b.subdomain}: got ${resp.data.articles?.length ?? 0} articles, first brand_id=${resp.data.articles?.[0]?.brand_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`   ${b.subdomain}: error - ${msg}`);
    }
  }
}

main().catch((err) => {
  console.error('Diagnostic failed:', err.message);
  if (err.response) console.error('  status:', err.response.status, 'body:', err.response.data);
});
