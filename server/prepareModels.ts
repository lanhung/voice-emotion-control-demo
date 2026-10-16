import { readLayaConfig } from './laya';
import { prepareLayaModel } from './modelSetup';

try {
  const config = readLayaConfig();
  if (!config) throw new Error('Invalid Ollama/Laya configuration.');
  await prepareLayaModel(config, (event) => console.info(JSON.stringify(event)));
} catch (error) {
  console.error(JSON.stringify({ event: 'model.setup_failed',
    reason: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
