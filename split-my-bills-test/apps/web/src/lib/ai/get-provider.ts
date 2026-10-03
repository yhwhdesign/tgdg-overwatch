import type { AIProvider } from "./provider";
import { OllamaProvider } from "./ollama-provider";
import { GeminiProvider } from "./gemini-provider";

export function getAIProvider(): AIProvider {
  if (process.env.NODE_ENV === "production") {
    return new GeminiProvider();
  }
  return new OllamaProvider();
}