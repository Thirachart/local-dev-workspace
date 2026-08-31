
export interface IPaymentGateway {
  charge(amount: number): Promise<boolean>;
}

export class StripeGateway implements IPaymentGateway {
  public async charge(amount: number): Promise<boolean> {
    return true;
  }
}
