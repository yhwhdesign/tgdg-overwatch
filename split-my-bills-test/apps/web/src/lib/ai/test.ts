import { OllamaProvider } from "./ollama-provider";
import type { AISuggestionInput } from "./provider";

const sampleData: AISuggestionInput = {
  periods: [
    {
      payDate: "2026-08-01",
      isCashflowRisk: true,
      shortfall: 150,
      isThreePaycheckMonth: false,
      totalBillAmount: 1200,
      income: 1050,
      bills: [
        { name: "Car Insurance", amount: 400, splittable: true },
        { name: "Rent", amount: 800, splittable: false },
      ],
    },
  ],
  splitSuggestions: [
    {
      billName: "Car Insurance",
      reasoning: "Splitting Car Insurance into two $200.00 payments would fully cover this period's $150.00 shortfall.",
      wouldResolve: true,
    },
  ],
  opportunitySuggestions: [],
};

async function main() {
  const provider = new OllamaProvider();
  const result = await provider.generateCoaching(sampleData);
  console.log("=== AI COACHING OUTPUT ===");
  console.log(result);
}

main();