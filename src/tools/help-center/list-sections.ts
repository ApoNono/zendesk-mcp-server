import { MultiBrandTool } from '../multi-brand-base.js';
import { BrandRegistry, ZendeskAPIClient } from '../../api/index.js';
import { Logger } from '../../utils/logger.js';

interface ListSectionsParams {
  brand?: string;
}

interface Category {
  id: number;
  name: string;
  position: number;
  html_url: string;
  outdated?: boolean;
}

interface Section {
  id: number;
  name: string;
  position: number;
  html_url: string;
  category_id: number;
  outdated?: boolean;
}

interface CategoriesResponse {
  categories: Category[];
  next_page?: string | null;
}
interface SectionsResponse {
  sections: Section[];
  next_page?: string | null;
}

export class ListSectionsTool extends MultiBrandTool<ListSectionsParams> {
  constructor(brandRegistry: BrandRegistry, logger: Logger) {
    super(
      'zd_sections_list',
      'List Help Center categories and their sections for one or all configured brands. Use this to find section IDs when moving articles with zd_article_update or scoping other tools by section.',
      {
        type: 'object',
        properties: {
          brand: {
            type: 'string',
            description:
              'Restrict to a single brand subdomain (e.g. "help-admin"). Omit to include every configured brand.',
          },
        },
      },
      brandRegistry,
      logger,
    );
  }

  protected async executeInternal(params: ListSectionsParams): Promise<unknown> {
    const brands = params.brand
      ? [{ subdomain: params.brand }].filter((b) => this.brands.hasBrand(b.subdomain))
      : this.brands.list();

    if (params.brand && brands.length === 0) {
      return {
        error: `Brand '${params.brand}' is not configured. Configured brands: ${this.brands
          .list()
          .map((b) => b.subdomain)
          .join(', ')}`,
      };
    }

    const results = await Promise.all(
      brands.map(async (brand) => {
        const client = this.brands.getClient(brand.subdomain);
        const [categories, sections] = await Promise.all([
          fetchAllCategories(client),
          fetchAllSections(client),
        ]);

        const sectionsByCategory = new Map<number, Section[]>();
        for (const section of sections) {
          const list = sectionsByCategory.get(section.category_id) ?? [];
          list.push(section);
          sectionsByCategory.set(section.category_id, list);
        }

        return {
          brand: brand.subdomain,
          category_count: categories.length,
          section_count: sections.length,
          categories: categories
            .sort((a, b) => a.position - b.position)
            .map((c) => ({
              id: c.id,
              name: c.name,
              position: c.position,
              url: c.html_url,
              outdated: c.outdated ?? false,
              sections: (sectionsByCategory.get(c.id) ?? [])
                .sort((a, b) => a.position - b.position)
                .map((s) => ({
                  id: s.id,
                  name: s.name,
                  position: s.position,
                  url: s.html_url,
                  outdated: s.outdated ?? false,
                })),
            })),
        };
      }),
    );

    return {
      brands_queried: brands.map((b) => b.subdomain),
      results,
    };
  }
}

async function fetchAllCategories(client: ZendeskAPIClient): Promise<Category[]> {
  const all: Category[] = [];
  let url: string | null = '/help_center/categories.json?per_page=100';
  while (url) {
    const resp: CategoriesResponse = await client.get<CategoriesResponse>(url);
    all.push(...resp.categories);
    url = resp.next_page ? resp.next_page.replace(/^.*\/api\/v2/, '') : null;
  }
  return all;
}

async function fetchAllSections(client: ZendeskAPIClient): Promise<Section[]> {
  const all: Section[] = [];
  let url: string | null = '/help_center/sections.json?per_page=100';
  while (url) {
    const resp: SectionsResponse = await client.get<SectionsResponse>(url);
    all.push(...resp.sections);
    url = resp.next_page ? resp.next_page.replace(/^.*\/api\/v2/, '') : null;
  }
  return all;
}
