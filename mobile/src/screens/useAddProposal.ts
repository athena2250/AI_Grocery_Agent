import { useCallback } from 'react';
import { useHousehold } from '../state/HouseholdContext';
import { useUI } from '../components/UIProvider';
import type { ProposedItem } from '../types';

/**
 * Mom confirming one suggestion (restock / prediction). Never auto-added.
 * Adding to an approved list reopens it as a draft — ask first (plan_08).
 */
export function useAddProposal() {
  const { state, acceptRestock } = useHousehold();
  const { ask, flash } = useUI();
  return useCallback((p: ProposedItem) => {
    const name = p.product.toLowerCase();
    const add = () => { acceptRestock(p); flash(`Added ${name} to groceries`); };
    if (state.list.status !== 'approved') return add();
    ask({
      title: 'Reopen your list?',
      body: `Your list is approved. Adding ${name} puts it back to draft.`,
      options: [{ label: `Add ${name}`, onPress: add }],
    });
  }, [state.list.status, acceptRestock, ask, flash]);
}
