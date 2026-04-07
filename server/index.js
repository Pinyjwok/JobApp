import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pipelineRouter, { initRecipe } from './routes/pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..'); // /Users/piny/JobApp

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', pipelineRouter);

const PORT = 3001;

async function main() {
  console.log('Starting KEMU recipe...');
  await initRecipe(PROJECT_DIR);
  console.log('Recipe running.');

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
