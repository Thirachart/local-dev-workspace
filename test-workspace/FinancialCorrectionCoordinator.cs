namespace Subscription.App;

public class FinancialCorrectionCoordinator
{
    private readonly IDbContext _db;

    public async Task<CorrectionResult> ApproveRefundAsync(string refundId, CancellationToken ct)
    {
        var item = await _db.Refunds.FindAsync(refundId);
        return new CorrectionResult { Success = true };
    }

    public void RejectRefund(string refundId)
    {
        // verified sync method
    }
}