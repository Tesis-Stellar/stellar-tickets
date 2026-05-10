export type PurchaseMode = "official" | "seats";

export const getOfficialPurchasePath = (eventId: string, hasSeatSelection: boolean) =>
  hasSeatSelection ? `/evento/${eventId}/asientos` : `/evento/${eventId}/boletas`;

export const getExpectedPurchaseMode = (hasSeatSelection: boolean): PurchaseMode =>
  hasSeatSelection ? "seats" : "official";

export const shouldRedirectPurchaseMode = (currentMode: PurchaseMode, hasSeatSelection: boolean) =>
  currentMode !== getExpectedPurchaseMode(hasSeatSelection);
