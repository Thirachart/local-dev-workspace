import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DeliveryScopeResolver } from '../src/context/deliveryScope.js';

describe('DeliveryScopeResolver', () => {
  it('resolves HTTP sessions and stdio process-local scope safely', () => {
    const http = new DeliveryScopeResolver('http', 'instance_1');
    const stdio = new DeliveryScopeResolver('stdio', 'instance_1');

    assert.deepEqual(http.resolve({ sessionId: 's1' }, 'project-a'), {
      scopeId: 'session:s1\u0000project:project-a',
      knowledgeScope: 'session',
      trackable: true,
    });

    assert.equal(http.resolve({}, 'project-a').knowledgeScope, 'unknown');
    assert.equal(http.resolve({}, 'project-a').trackable, false);
    assert.equal(stdio.resolve({}, 'project-a').knowledgeScope, 'process_local');
    assert.equal(
      stdio.resolve({}, 'project-a').scopeId,
      'process:instance_1\u0000project:project-a',
    );
  });

  it('keeps session/project isolation stable', () => {
    const resolver = new DeliveryScopeResolver('http', 'instance_1');
    const first = resolver.resolve({ sessionId: 'same-session' }, 'project-a');
    const same = resolver.resolve({ sessionId: 'same-session' }, 'project-a');
    const otherProject = resolver.resolve({ sessionId: 'same-session' }, 'project-b');

    assert.equal(first.scopeId, same.scopeId);
    assert.notEqual(first.scopeId, otherProject.scopeId);
  });

  it('treats arbitrary session strings as opaque scope inputs', () => {
    const resolver = new DeliveryScopeResolver('http', 'instance_1');
    const sessionId = 'del_project/path?x=1';
    const result = resolver.resolve({ sessionId }, 'project-a');

    assert.equal(result.scopeId, `session:${sessionId}\u0000project:project-a`);
    assert.equal(result.knowledgeScope, 'session');
    assert.equal(result.trackable, true);
  });
});
