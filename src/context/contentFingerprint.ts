import crypto from 'node:crypto';

export function sha256Content(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
