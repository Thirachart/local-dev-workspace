export type DeliveryTransport = 'stdio' | 'http';
export type KnowledgeScope = 'session' | 'process_local' | 'unknown';

export interface DeliveryScope {
  scopeId?: string;
  knowledgeScope: KnowledgeScope;
  trackable: boolean;
}

export interface DeliveryRequestContext {
  sessionId?: string;
}

export class DeliveryScopeResolver {
  constructor(
    private readonly transport: DeliveryTransport,
    private readonly processInstanceId: string,
  ) {}

  public resolve(extra: DeliveryRequestContext | undefined, projectId: string): DeliveryScope {
    if (this.transport === 'http') {
      if (!extra?.sessionId) {
        return {
          knowledgeScope: 'unknown',
          trackable: false,
        };
      }

      return {
        scopeId: `session:${extra.sessionId}\u0000project:${projectId}`,
        knowledgeScope: 'session',
        trackable: true,
      };
    }

    return {
      scopeId: `process:${this.processInstanceId}\u0000project:${projectId}`,
      knowledgeScope: 'process_local',
      trackable: true,
    };
  }
}
