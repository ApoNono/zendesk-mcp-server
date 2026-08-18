import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ToolRegistry } from './registry.js';
import { PromptRegistry } from './prompt-registry.js';
import { Tool, Prompt } from './types.js';
import { AuthenticationManager } from '../auth/index.js';
import { BrandRegistry } from '../api/index.js';
import { RateLimiter } from '../middleware/index.js';
import { Config, Logger } from '../utils/index.js';
import { ServerError, ToolExecutionError } from '../utils/errors.js';

import {
  SearchArticlesTool,
  GetArticleTool,
  SearchTicketsTool,
  GetTicketTool,
  CountTicketsByTool,
  SearchOrganizationsTool,
  GetOrganizationTool,
  SearchUsersTool,
  SatisfactionSummaryTool,
  ListSatisfactionRatingsTool,
  ListSectionsTool,
  ListRecentArticlesTool,
  UpdateArticleTool,
  CreateArticleTool,
  FindTextInArticlesTool,
  ReplaceTextInArticlesTool,
} from '../tools/index.js';
import { FindPBInsightsForTicketPrompt, WeeklySupportDigestPrompt } from '../prompts/index.js';

const SERVER_NAME = 'zendesk-mcp-server';
const SERVER_VERSION = '0.4.1';

export class ZendeskMCPServer {
  private server?: Server;
  private transport?: StdioServerTransport;
  private readonly logger: Logger;
  private readonly authManager: AuthenticationManager;
  private readonly brandRegistry: BrandRegistry;
  private readonly rateLimiter: RateLimiter;
  private readonly toolRegistry: ToolRegistry;
  private readonly promptRegistry: PromptRegistry;

  constructor(config: Config) {
    this.logger = new Logger({ level: config.logLevel, pretty: config.logPretty });

    this.authManager = new AuthenticationManager(
      { email: config.auth.email, apiToken: config.auth.apiToken },
      this.logger,
    );

    this.rateLimiter = new RateLimiter(
      config.rateLimit.global,
      config.rateLimit.windowMs,
      config.rateLimit.perTool,
    );

    this.brandRegistry = new BrandRegistry(
      config.auth.brands,
      config.api,
      this.authManager,
      this.logger,
      this.rateLimiter,
    );

    this.toolRegistry = new ToolRegistry(this.logger);
    this.promptRegistry = new PromptRegistry(this.logger);
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing Zendesk MCP Server...', {
      brands: this.brandRegistry.list().map((b) => b.subdomain),
    });
    this.initializeMCPServer();

    if (process.env.NODE_ENV !== 'test') {
      this.logger.info('Validating Zendesk credentials...');
      const primary = this.brandRegistry.primary();
      const ok = await this.authManager.validateCredentials(primary.subdomain);
      if (!ok) {
        throw new ServerError('Zendesk credential validation failed (HTTP 401)');
      }
      this.logger.info('Credentials valid');
    }

    this.registerTools();
    this.registerPrompts();
    this.logger.info(
      `Initialized with ${this.toolRegistry.size()} tools and ${this.promptRegistry.size()} prompts`,
    );
  }

  async start(): Promise<void> {
    if (!this.server || !this.transport) throw new ServerError('Server not initialized');
    await this.server.connect(this.transport);
    this.logger.info('Server connected to stdio transport');
  }

  async stop(): Promise<void> {
    if (this.server) await this.server.close();
    this.logger.info('Server stopped');
  }

  private registerTools(): void {
    const primaryClient = this.brandRegistry.primaryClient();
    // Existing single-brand tools use the primary brand. Cross-brand tools
    // (article-management writes, find/replace, sections listing) take the
    // BrandRegistry so they can operate across every configured brand.
    const tools: Tool[] = [
      new SearchArticlesTool(primaryClient, this.logger),
      new GetArticleTool(primaryClient, this.logger),
      new SearchTicketsTool(primaryClient, this.logger),
      new GetTicketTool(primaryClient, this.logger),
      new CountTicketsByTool(primaryClient, this.logger),
      new SearchOrganizationsTool(primaryClient, this.logger),
      new GetOrganizationTool(primaryClient, this.logger),
      new SearchUsersTool(primaryClient, this.logger),
      new SatisfactionSummaryTool(primaryClient, this.logger),
      new ListSatisfactionRatingsTool(primaryClient, this.logger),
      new ListSectionsTool(this.brandRegistry, this.logger),
      new ListRecentArticlesTool(this.brandRegistry, this.logger),
      new UpdateArticleTool(this.brandRegistry, this.logger),
      new CreateArticleTool(this.brandRegistry, this.logger),
      new FindTextInArticlesTool(this.brandRegistry, this.logger),
      new ReplaceTextInArticlesTool(this.brandRegistry, this.logger),
    ];
    for (const tool of tools) this.toolRegistry.registerTool(tool);
  }

  private registerPrompts(): void {
    const prompts: Prompt[] = [
      new FindPBInsightsForTicketPrompt(),
      new WeeklySupportDigestPrompt(),
    ];
    for (const prompt of prompts) this.promptRegistry.registerPrompt(prompt);
  }

  private initializeMCPServer(): void {
    this.server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {}, prompts: {} } },
    );
    this.transport = new StdioServerTransport();

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.toolRegistry.listTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params as { name: string; arguments?: unknown };

      try {
        const result = await this.toolRegistry.invokeTool(name, args);
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        this.logger.error(`Tool ${name} execution failed`, error);
        if (error instanceof ToolExecutionError) throw error;
        throw new ToolExecutionError(
          error instanceof Error ? error.message : 'Unknown error during tool execution',
          name,
          error instanceof Error ? error : undefined,
        );
      }
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: this.promptRegistry.listPrompts(),
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params as {
        name: string;
        arguments?: Record<string, string>;
      };
      const messages = this.promptRegistry.renderPrompt(name, args ?? {});
      return { messages };
    });
  }
}
