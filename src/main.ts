import { startLab } from './lab.ts';
import { startUi } from './ui-server.ts';

const lab = await startLab({ port: 4180 });
let ui: Awaited<ReturnType<typeof startUi>>;
try { ui = await startUi(lab.url, 4181); }
catch (error) { await lab.stop(); throw error; }
console.log(`Federated Catalog Lab\nDemo: ${ui.url}\nGraphQL: ${lab.url}\nSynthetic fixtures only. Ctrl+C to stop all local servers.`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await ui.stop();
  await lab.stop();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
