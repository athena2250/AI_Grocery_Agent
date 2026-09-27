import type { AIService } from './AIService';
import { MockAIService } from './MockAIService';

let aiService: AIService | null = null;

export function getAIService(): AIService {
  if (!aiService) aiService = new MockAIService();
  return aiService;
}
