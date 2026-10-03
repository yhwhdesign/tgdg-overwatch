// Suggests a category based on keywords in a bill's name, as the user types.
// Categories here intentionally match the exact keys getCategoryIcon() recognizes
// in dashboard/page.tsx, so a suggested category always has a matching icon.

const KEYWORD_MAP: { keywords: string[]; category: string }[] = [
  { keywords: ["mortgage", "rent", "landlord", "hoa"], category: "housing" },
  { keywords: ["car loan", "auto loan", "vehicle loan", "car finance"], category: "car loan" },
  { keywords: ["car insurance", "auto insurance", "geico", "progressive", "state farm"], category: "car insurance" },
  { keywords: ["electric", "electricity", "power company", "entergy", "duke energy"], category: "electric" },
  { keywords: ["water", "sewer", "utility water"], category: "water" },
  { keywords: ["gas company", "natural gas", "propane"], category: "gas" },
  { keywords: ["internet", "wifi", "broadband", "xfinity", "spectrum", "comcast"], category: "internet" },
  { keywords: ["phone", "cell", "verizon", "at&t", "att", "t-mobile", "tmobile"], category: "phone" },
  { keywords: ["netflix", "hulu", "spotify", "disney+", "disney plus", "apple music", "youtube", "prime", "subscription", "membership"], category: "subscription" },
  { keywords: ["health", "medical", "insurance premium", "dental", "vision", "blue cross", "aetna", "cigna"], category: "health/medical" },
  { keywords: ["credit card", "visa", "mastercard", "amex", "discover card", "capital one"], category: "credit card" },
];

export function suggestCategory(billName: string): string | null {
  const name = billName.toLowerCase().trim();
  if (!name) return null;

  for (const { keywords, category } of KEYWORD_MAP) {
    if (keywords.some((keyword) => name.includes(keyword))) {
      return category;
    }
  }

  return null;
}