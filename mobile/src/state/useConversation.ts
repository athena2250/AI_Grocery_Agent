import { useCallback, useMemo, useState } from 'react';
import { useHousehold } from './HouseholdContext';
import { getAIService } from '../services/serviceFactory';
import type { AIResponse } from '../types';

/**
 * One user turn through the AI service: log the user turn, call the service
 * with the current context, log the agent reply (+ chips for its first
 * clarification), apply the response. Shared by the compose sheet and the
 * conversation screen so both drive the exact same pipeline.
 */
export function useConversation() {
  const { state, addUserTurn, addAgentTurn, applyAI, buildChatContext } = useHousehold();
  const [busy, setBusy] = useState(false);
  const ai = useMemo(() => getAIService(), []);

  const send = useCallback(async (raw: string, clarificationId?: string): Promise<AIResponse | null> => {
    const message = raw.trim();
    if (!message || busy) return null;
    setBusy(true);
    addUserTurn(message);
    try {
      const ctx = { ...buildChatContext(), answeringClarificationId: clarificationId };
      const response = await ai.chat(message, ctx);
      const clar = response.clarifications[0];
      addAgentTurn(response.reply, clar?.options, clar?.id);
      applyAI(response);
      return response;
    } finally {
      setBusy(false);
    }
  }, [busy, addUserTurn, addAgentTurn, applyAI, buildChatContext, ai]);

  // Chips stay live on the newest bubble for each clarification still pending,
  // so an unrelated request doesn't strand an earlier question (plan_04).
  const liveChipTurnIds = useMemo(() => {
    const pendingIds = new Set(state.pendingClarifications.map((c) => c.id));
    const byClar = new Map<string, string>();
    for (const t of state.turns) {
      if (t.clarificationId && pendingIds.has(t.clarificationId)) byClar.set(t.clarificationId, t.id);
    }
    return new Set(byClar.values());
  }, [state.turns, state.pendingClarifications]);

  return { send, busy, liveChipTurnIds };
}
