import type { AIProvider, AISuggestionInput } from "./provider";
import { buildCoachingPrompt } from "./prompt";

const OLLAMA_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

export class OllamaProvider implements AIProvider {
  async generateCoaching(input: AISuggestionInput): Promise<string> {
    const prompt = buildCoachingPrompt(input);

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2:3b",
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response;
  }
}