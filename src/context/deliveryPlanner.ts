import { ContextLedger, type DeliveryRecordMode } from './contextLedger.js';
import { sha256Content } from './contentFingerprint.js';
import { createBoundedLineDiff } from './resultCompressor.js';
import type { KnowledgeScope } from './deliveryScope.js';

export type DeliveryMode = 'full' | 'diff' | 'unchanged' | 'reference';
export type DeliveryFallback = 'base_not_cached' | 'scope_unavailable';

export interface DeliveryPlan {
  delivery: DeliveryMode;
  deliveryId: string;
  deliveryFallback?: DeliveryFallback;
  sha256: string;
  baseSha256?: string;
  content?: string;
  patch?: string;
  previousOperationId?: string;
  truncated?: boolean;
  /** Internal two-phase bookkeeping. Not serialized by tool handlers. */
  recordMode?: DeliveryRecordMode;
  createsRecord?: boolean;
  confirmationSha256?: string;
  operationId?: string;
}

export class DeliveryPlanner {
  constructor(private readonly ledger: ContextLedger) {}

  public plan(options: {
    scope?: string;
    projectId?: string;
    knowledgeScope?: KnowledgeScope;
    key: string;
    content: string;
    knownSha256?: string;
    operationId?: string;
    maxChars?: number;
  }): DeliveryPlan {
    const sha256 = sha256Content(options.content);
    const projectId = options.projectId ?? 'legacy';
    const scopeUnavailable = options.knowledgeScope === 'unknown';
    const scope = scopeUnavailable
      ? undefined
      : options.scope ?? `process:legacy\u0000project:${projectId}`;

    if (options.knownSha256 === sha256) {
      if (!scope) {
        return {
          delivery: 'unchanged',
          deliveryId: this.ledger.createDeliveryId(),
          deliveryFallback: 'scope_unavailable',
          sha256,
          createsRecord: false,
          operationId: options.operationId,
        };
      }

      const known = this.ledger.get(scope, options.key, sha256);
      if (known) {
        return {
          delivery: 'unchanged',
          deliveryId: known.deliveryId,
          sha256,
          previousOperationId: known.operationId,
          createsRecord: false,
          confirmationSha256: sha256,
          operationId: options.operationId,
        };
      }

      return {
        delivery: 'unchanged',
        deliveryId: this.ledger.createDeliveryId(),
        sha256,
        recordMode: 'reference',
        createsRecord: true,
        operationId: options.operationId,
      };
    }

    if (options.knownSha256) {
      if (!scope) {
        return {
          delivery: 'full',
          deliveryId: this.ledger.createDeliveryId(),
          deliveryFallback: 'scope_unavailable',
          sha256,
          content: options.content,
          createsRecord: false,
          operationId: options.operationId,
        };
      }

      const previous = this.ledger.get(scope, options.key, options.knownSha256);
      const previousContent = this.ledger.getContent(scope, options.key, options.knownSha256);
      if (previousContent !== undefined) {
        const diff = createBoundedLineDiff(previousContent, options.content, options.maxChars);
        return {
          delivery: 'diff',
          deliveryId: this.ledger.createDeliveryId(),
          sha256,
          baseSha256: options.knownSha256,
          patch: diff.patch,
          truncated: diff.truncated,
          recordMode: 'diff',
          createsRecord: true,
          confirmationSha256: previous ? options.knownSha256 : undefined,
          operationId: options.operationId,
        };
      }

      return {
        delivery: 'full',
        deliveryId: this.ledger.createDeliveryId(),
        deliveryFallback: 'base_not_cached',
        sha256,
        baseSha256: options.knownSha256,
        content: options.content,
        recordMode: 'full',
        createsRecord: true,
        confirmationSha256: previous ? options.knownSha256 : undefined,
        operationId: options.operationId,
      };
    }

    return {
      delivery: 'full',
      deliveryId: this.ledger.createDeliveryId(),
      deliveryFallback: scope ? undefined : 'scope_unavailable',
      sha256,
      content: options.content,
      recordMode: 'full',
      createsRecord: Boolean(scope),
      operationId: options.operationId,
    };
  }

  public commit(options: {
    scope: string;
    projectId: string;
    key: string;
    content: string;
    plan: DeliveryPlan;
  }): void {
    const { scope, projectId, key, content, plan } = options;

    if (plan.confirmationSha256) {
      this.ledger.confirmHash(scope, key, plan.confirmationSha256);
    }

    if (!plan.createsRecord) return;

    const mode: DeliveryRecordMode = plan.recordMode
      ?? (plan.delivery === 'diff' ? 'diff' : plan.delivery === 'unchanged' ? 'reference' : 'full');
    const record = this.ledger.createRecord({
      deliveryId: plan.deliveryId,
      scope,
      projectId,
      key,
      sha256: plan.sha256,
      mode,
      baseSha256: plan.baseSha256,
      operationId: plan.operationId,
    });
    this.ledger.commit(record, content);
  }
}
