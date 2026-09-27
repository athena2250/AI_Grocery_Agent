import type { AIResponse, ChatContext } from '../types';

export interface AIService {
  chat(text: string, ctx: ChatContext): Promise<AIResponse>;
}
