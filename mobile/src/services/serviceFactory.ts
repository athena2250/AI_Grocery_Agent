import type { AIService } from './AIService';
import { MockAIService } from './MockAIService';
import type { AuthService } from './AuthService';
import { MockAuthService } from './MockAuthService';

let aiService: AIService | null = null;
let authService: AuthService | null = null;

export function getAIService(): AIService {
  if (!aiService) aiService = new MockAIService();
  return aiService;
}

export function getAuthService(): AuthService {
  if (!authService) authService = new MockAuthService();
  return authService;
}
