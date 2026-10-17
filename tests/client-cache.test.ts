import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { runClientCacheExperiment } from '../src/client-cache-experiment.ts';
import { checkClientCacheEvidence, checkClientCacheReport } from '../src/client-cache-check.ts';

describe('Apollo Client policy/cache boundary over actual Federation HTTP', { timeout: 30_000 }, () => {
  let recording: Awaited<ReturnType<typeof runClientCacheExperiment>>;
  before(async () => { recording = await runClientCacheExperiment(); });

  it('distinguishes a lost error, retained old inventory and a fresh failing request', () => {
    const checked = checkClientCacheReport(recording);
    assert.equal(checked.evidenceValid, true, checked.violations.join('\n'));
    assert.deepEqual(checked.observations?.map(item => [item.id, item.nextHttpRequests, item.nextHasError, item.nextLampQuantity]), [
      ['all-cold', 0, false, null], ['none-warm', 0, false, 3], ['all-warm', 0, false, null],
      ['ignore-warm', 0, false, null], ['all-no-cache', 1, true, null],
    ]);
    const rejected = recording.cases[1]!.steps[1]!.result;
    assert.equal(rejected.dataPresent, false);
    assert.equal((rejected.error as { dataPresent: boolean }).dataPresent, true,
      'none rejects the promise but its CombinedGraphQLErrors retains the partial response data.');
  });

  function rejected(mutate: (copy: any) => void, reason: RegExp) {
    const copy = structuredClone(recording);
    mutate(copy);
    const checked = checkClientCacheReport(copy);
    assert.equal(checked.evidenceValid, false);
    assert.equal(checked.observations, null, 'Invalid evidence cannot supply display metrics.');
    assert.match(checked.violations.join('\n'), reason);
  }
  function rewriteBody(copy: any, mutate: (body: any) => void) {
    const response = copy.cases[0].steps[0].http[0].response;
    const body = JSON.parse(response.bodyText);
    mutate(body);
    response.bodyText = JSON.stringify(body);
    response.sha256 = createHash('sha256').update(response.bodyText).digest('hex');
  }

  it('rejects a network refresh claim without a matching request and a changed fallback server', () => {
    rejected(copy => { copy.cases[4].steps[1].http = []; }, /HTTP request count/);
    rejected(copy => { copy.cases[4].steps[1].http[0].endpoint = 'healthy'; }, /HTTP target/);
    rejected(copy => { copy.cases[1].steps.reverse(); }, /Step order/);
  });

  it('rejects manufactured error history or old data replaced while claiming preservation', () => {
    rejected(copy => { copy.cases[0].steps[1].result.error = copy.cases[0].steps[0].result.error; }, /settlement\/data\/error/);
    rejected(copy => { copy.cases[1].steps[1].cacheAfter['Product:{"sku":"demo-lamp"}'].availability = null; }, /cache write\/preservation/);
    rejected(copy => { copy.cases[1].steps[2].readAfter.products[1].availability.quantity = 0; }, /cache.readQuery/);
    rejected(copy => { copy.cases[1].steps[1].result.error.data = null; }, /settlement\/data\/error/);
  });

  it('checks raw response integrity and semantics independently of producer summaries', () => {
    rejected(copy => { copy.cases[0].steps[0].http[0].response.bodyText += ' '; }, /SHA-256/);
    rejected(copy => rewriteBody(copy, body => { body.errors[0].path[1] = 0; }), /error path\/cause/);
    rejected(copy => rewriteBody(copy, body => { body.data.products[1].availability = { __typename: 'Availability', status: 'SOLD_OUT', quantity: 0 }; }), /gateway values/);
    rejected(copy => { copy.cases[4].steps[1].http[0].response = copy.cases[4].steps[0].http[0].response; }, /Reused gateway/);
  });

  it('binds downstream key order, actual selected fields and independent client normalization', () => {
    rejected(copy => rewriteBody(copy, body => { body.extensions.lab.fetches.find((item: any) => item.service === 'inventory').captured.request.query = '{ __typename }'; }), /Subgraph operation/);
    rejected(copy => rewriteBody(copy, body => { body.extensions.lab.fetches.find((item: any) => item.service === 'inventory').captured.request.variables.representations.reverse(); }), /entity mapping/);
    rejected(copy => rewriteBody(copy, body => { body.extensions.lab.fetches.find((item: any) => item.service === 'inventory').captured.response.extensions.lab.batches[0].keys.reverse(); }), /Captured subgraph batches/);
    rejected(copy => { copy.cacheConfiguration.typePolicies.Product.keyFields = ['id']; }, /keyFields/);
    const equivalent: any = structuredClone(recording);
    rewriteBody(equivalent, body => {
      const request = body.extensions.lab.fetches.find((item: any) => item.service === 'inventory').captured.request;
      request.query = `query DifferentGeneratedName($representations:[_Any!]!) { _entities(representations:$representations) {
        ... on Product { availability { quantity __typename status } }
      } }`;
    });
    assert.equal(checkClientCacheEvidence(equivalent).evidenceValid, true, 'Do not pin generated names or field order.');
  });

  it('requires complete coverage and recomputes source consistency instead of trusting the flag', () => {
    rejected(copy => { copy.cases.splice(2, 1); }, /coverage/);
    rejected(copy => { copy.sourceAfter.manifest[0].sha256 = '0'.repeat(64); }, /manifest digest/);
    rejected(copy => { copy.sourceAfter.git.head = '0'.repeat(40); }, /Source changed/);
    rejected(copy => { copy.tooling.packages['@apollo/client'] = '0.0.0'; }, /4.3.3/);
    for (const invalid of [null, {}, [], { cases: [] }]) assert.equal(checkClientCacheReport(invalid).evidenceValid, false);
  });

  it('requires usable provenance fields even when a malformed manifest has a matching outer digest', () => {
    function rewriteSources(copy: any, mutate: (source: any) => void) {
      for (const source of [copy.sourceBefore, copy.sourceAfter]) {
        mutate(source);
        source.sha256 = createHash('sha256').update(JSON.stringify(source.manifest)).digest('hex');
      }
    }
    for (const key of ['node', 'platform', 'arch']) {
      rejected(copy => { delete copy.tooling[key]; }, /required/);
    }
    for (const name of Object.keys(recording.tooling.packages)) {
      rejected(copy => { delete copy.tooling.packages[name]; }, /versions changed or are incomplete/);
    }
    rejected(copy => rewriteSources(copy, source => { source.manifest[0].sha256 = 'not-a-file-digest'; }), /file digest/);
    rejected(copy => rewriteSources(copy, source => { source.manifest.splice(1, 0, structuredClone(source.manifest[0])); }), /unique and sorted/);
    rejected(copy => rewriteSources(copy, source => { delete source.manifest[0].path; }), /source path/);
    for (const path of ['', '/outside/source.ts', 'C:/outside/source.ts', '../source.ts', 'src/../source.ts', 'src\\source.ts']) {
      rejected(copy => rewriteSources(copy, source => { source.manifest[0].path = path; }), /normalized relative file paths/);
    }
    rejected(copy => rewriteSources(copy, source => { source.manifest = []; }), /must not be empty/);
    rejected(copy => rewriteSources(copy, source => { source.manifest = source.manifest.filter((entry: any) => entry.path !== 'src/client-cache-experiment.ts'); }), /Missing required source file/);
    rejected(copy => rewriteSources(copy, source => { delete source.git; }), /Git state/);
    rejected(copy => rewriteSources(copy, source => { source.git = { head: 'not-an-oid', branch: 'main', dirty: false }; }), /Git head/);
    rejected(copy => rewriteSources(copy, source => { source.git = { head: 'a'.repeat(40), branch: 'main', dirty: 'false' }; }), /dirty state/);
    const noGit: any = structuredClone(recording);
    noGit.sourceBefore.git = noGit.sourceAfter.git = null;
    assert.equal(checkClientCacheReport(noGit).evidenceValid, true, 'Unavailable Git is explicit null; a source manifest can still be useful.');
  });
});
