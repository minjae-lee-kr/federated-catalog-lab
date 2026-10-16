import { startLab } from './lab.ts';
import { loadOperations } from './schema.ts';
import { scenarios } from './scenarios.ts';
import { sampleSkus } from './data.ts';

const lab = await startLab();
try {
  for (const scenario of scenarios) {
    const response = await fetch(lab.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lab-scenario': scenario },
      body: JSON.stringify({ query: loadOperations()['CatalogCards.graphql'], variables: { skus: sampleSkus } }),
    });
    console.log(JSON.stringify({ scenario, result: await response.json() }, null, 2));
  }
} finally { await lab.stop(); }
