import { startCancellationUi } from './cancellation-ui-server.ts';
const ui = await startCancellationUi(4182);
console.log(`Cancellation Debt Experiment: ${ui.url}\nSynthetic work; real HTTP/socket cancellation. Experimental branch only.`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void ui.stop().catch(error => { console.error(error); process.exitCode = 1; }); });
