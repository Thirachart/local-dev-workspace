import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ContextLedger } from '../src/context/contextLedger.js';
import { DeliveryPlanner } from '../src/context/deliveryPlanner.js';
import { sha256Content } from '../src/context/contentFingerprint.js';

describe('Context delivery ledger', () => {
  it('keeps prepare separate from server-emitted commit and records confirmation truthfully', () => {
    let now = 1_000;
    let ids = 0;
    const ledger = new ContextLedger({
      now: () => now,
      idFactory: () => `id-${++ids}`,
      ttlMs: 1_000,
    });
    const planner = new DeliveryPlanner(ledger);
    const scope = 'session:s1\u0000project:p1';
    const key = 'sample.txt:1-2';
    const content = 'a\nb';
    const sha256 = sha256Content(content);

    const first = planner.plan({ scope, projectId: 'p1', key, content });
    assert.equal(first.delivery, 'full');
    assert.match(first.deliveryId, /^del_/);

    const beforeCommit = ledger.getStatus(scope, key, sha256);
    assert.equal(beforeCommit.status, 'never_delivered');
    assert.equal(beforeCommit.evidence.serverEmitted, false);

    planner.commit({ scope, projectId: 'p1', key, content, plan: first });
    const afterCommit = ledger.getStatus(scope, key, sha256);
    assert.equal(afterCommit.status, 'delivered_unconfirmed');
    assert.equal(afterCommit.evidence.serverEmitted, true);
    assert.equal(afterCommit.evidence.hashConfirmed, false);
    assert.equal('content' in afterCommit, false);

    const second = planner.plan({
      scope,
      projectId: 'p1',
      key,
      content,
      knownSha256: first.sha256,
    });
    assert.equal(second.delivery, 'unchanged');
    assert.equal(second.deliveryId, first.deliveryId);

    planner.commit({ scope, projectId: 'p1', key, content, plan: second });
    const confirmed = ledger.getStatus(scope, key, sha256);
    assert.equal(confirmed.status, 'delivered_hash_confirmed');
    assert.equal(confirmed.evidence.hashConfirmed, true);

    const record = ledger.get(scope, key, sha256)!;
    assert.equal(record.deliveryId, first.deliveryId);
    assert.equal(record.serverEmittedAt, 1_000);
    assert.equal(record.hashConfirmedAt, 1_000);
    assert.equal('content' in record, false);
  });

  it('returns diff for a cached older base and a new delivery id', () => {
    let ids = 0;
    const ledger = new ContextLedger({ idFactory: () => `id-${++ids}` });
    const planner = new DeliveryPlanner(ledger);
    const scope = 'session:s1\u0000project:p1';
    const key = 'sample.txt:1-2';

    const first = planner.plan({ scope, projectId: 'p1', key, content: 'a\nb' });
    planner.commit({ scope, projectId: 'p1', key, content: 'a\nb', plan: first });

    const changedContent = 'a\nc';
    const changed = planner.plan({
      scope,
      projectId: 'p1',
      key,
      content: changedContent,
      knownSha256: first.sha256,
    });

    assert.equal(changed.delivery, 'diff');
    assert.notEqual(changed.deliveryId, first.deliveryId);
    assert.match(changed.patch || '', /-b/);
    assert.match(changed.patch || '', /\+c/);

    const statusBeforeRead = ledger.getStatus(scope, key, sha256Content(changedContent));
    assert.equal(statusBeforeRead.status, 'content_changed');
    assert.equal(statusBeforeRead.recommendedDelivery, 'diff');
  });

  it('isolates sessions/projects and reports fresh scopes as never delivered', () => {
    const ledger = new ContextLedger({ idFactory: () => 'id-1' });
    const planner = new DeliveryPlanner(ledger);
    const scopeA = 'session:a\u0000project:p1';
    const scopeB = 'session:b\u0000project:p1';
    const scopeOtherProject = 'session:a\u0000project:p2';
    const key = 'sample.txt:1-1';
    const content = 'one';
    const sha = sha256Content(content);

    const first = planner.plan({ scope: scopeA, projectId: 'p1', key, content });
    planner.commit({ scope: scopeA, projectId: 'p1', key, content, plan: first });

    assert.equal(ledger.getStatus(scopeB, key, sha).status, 'never_delivered');
    assert.equal(ledger.getStatus(scopeOtherProject, key, sha).status, 'never_delivered');
    assert.equal(ledger.get(scopeB, key, sha), undefined);
    assert.equal(ledger.get(scopeOtherProject, key, sha), undefined);
  });

  it('reports unknown after an expired record rather than pretending it was never delivered', () => {
    let now = 10_000;
    const ledger = new ContextLedger({
      now: () => now,
      idFactory: () => 'id-1',
      ttlMs: 100,
    });
    const planner = new DeliveryPlanner(ledger);
    const scope = 'session:a\u0000project:p1';
    const key = 'sample.txt:1-1';
    const content = 'one';
    const sha = sha256Content(content);

    const first = planner.plan({ scope, projectId: 'p1', key, content });
    planner.commit({ scope, projectId: 'p1', key, content, plan: first });
    assert.equal(ledger.getStatus(scope, key, sha).status, 'delivered_unconfirmed');

    now += 101;
    const expired = ledger.getStatus(scope, key, sha);
    assert.equal(expired.status, 'unknown');
    assert.equal(expired.resendRequired, null);
    assert.equal(expired.recommendedDelivery, 'unknown');
  });
});
