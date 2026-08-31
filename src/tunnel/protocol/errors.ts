export type TunnelErrorCategory = 'auth' | 'permission' | 'validation' | 'execution' | 'protocol';

export interface TunnelErrorDetails {
  code: string;
  category: TunnelErrorCategory;
  message: string;
  details?: Record<string, unknown>;
}

export class TunnelError extends Error {
  public readonly code: string;
  public readonly category: TunnelErrorCategory;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, category: TunnelErrorCategory, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'TunnelError';
    this.code = code;
    this.category = category;
    this.details = details;
    Object.setPrototypeOf(this, TunnelError.prototype);
  }

  public toJSON(): TunnelErrorDetails {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
