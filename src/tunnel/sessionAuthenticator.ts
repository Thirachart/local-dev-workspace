import type { SessionMiddleware } from '../session/sessionMiddleware.js';

export class SessionAuthenticator {
  constructor(private readonly middleware: SessionMiddleware) {}

  authenticate(request: Record<string, unknown>, capability?: string) {
    return this.middleware.resolve(request as any, capability);
  }
}
