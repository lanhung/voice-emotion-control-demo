import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { loadReactionCatalog } from '../server/reactionCatalog';

if (existsSync('.env')) loadEnvFile('.env');
try {
  const catalog = await loadReactionCatalog(process.argv[2] ?? process.env.REACTION_CATALOG_PATH);
  console.info(`Reaction catalog ${catalog.version}: ${catalog.phrases.length} valid phrases (${catalog.phrases.filter((phrase) => phrase.enabled).length} enabled).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Catalog validation failed');
  process.exitCode = 1;
}
