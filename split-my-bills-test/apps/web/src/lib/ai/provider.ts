export interface AISuggestionInput {
  periods: Array<{
    payDate: string;
    isCashflowRisk: boolean;
    shortfall: number;
    isThreePaycheckMonth: boolean;
    totalBillAmount: number;
    income: number;
    bills: Array<{ name: string; amount: number; splittable: boolean }>;
  }>;
  splitSuggestions: Array<{
    billName: string;
    reasoning: string;
    wouldResolve: boolean;
  }>;
  opportunitySuggestions: Array<{
    payDate: string;
    reasoning: string;
  }>;
}

export interface AIProvider {
  generateCoaching(input: AISuggestionInput): Promise<string>;
}