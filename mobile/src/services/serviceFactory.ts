import type { AIService } from './AIService';
import { MockAIService } from './MockAIService';
import type { AuthService } from './AuthService';
import { MockAuthService } from './MockAuthService';
import { HttpAuthService } from './HttpAuthService';
import { api, getSessionToken, isOnline } from './api';
import { HybridAIService, type Extraction } from './HybridAIService';

let aiService: AIService | null = null;
let authService: AuthService | null = null;

/** How long Mom waits for the server's LLM before the phone's own rules answer instead. */
const UNDERSTAND_TIMEOUT_MS = 25_000;

/**
 * Sandbox: the on-phone rules only. Signed in to a server: the same rules, with the
 * server's LLM (`POST /understand`) for messages they don't recognise (HybridAIService).
 */
export function getAIService(): AIService {
  if (aiService) return aiService;
  aiService = isOnline()
    ? new HybridAIService(async (text) => {
      const token = getSessionToken();
      if (!token) return null;
      try {
        const r = await api<{ extraction: Extraction }>('/understand', { body: { text }, token, timeoutMs: UNDERSTAND_TIMEOUT_MS });
        return r.extraction;
      } catch {
        return null; // offline, LLM down or slow: the rules answer
      }
    })
    : new MockAIService();
  return aiService;
}

export function getAuthService(): AuthService {
  if (!authService) authService = isOnline() ? new HttpAuthService() : new MockAuthService();
  return authService;
}
