#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv';
import { ZendeskMCPServer } from './core/index.js';
import { ConfigManager } from './utils/config.js';
import { Logger } from './utils/logger.js';

loadDotenv();

async function main(): Promise<void> {
  const configManager = new ConfigManager();
  const configuration = configManager.get();
  const logger = new Logger({ level: configuration.logLevel, pretty: configuration.logPretty });

  const validation = configManager.validate();
  if (!validation.valid) {
    logger.fatal('Configuration validation failed', { errors: validation.errors });
    process.exit(1);
  }

  const server = new ZendeskMCPServer(configuration);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down...`);
    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await server.initialize();
    await server.start();
    logger.info('Server is running');
  } catch (error) {
    logger.fatal('Server startup failed', error);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Unhandled error: ${error}\n`);
  process.exit(1);
});
