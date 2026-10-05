import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { AIResponse, Category, ChatContext, HouseholdState, InventoryUpdate, ProposedItem } from '../types';
import { initialHouseholdState } from '../data/seed';
import { loadPersisted, savePersisted, clearPersisted } from './persistence';
import { buildChatContext as buildContextFor, reducer, uid, type ManualItem } from './reducer';
import type { UsualFields } from './memory';
import { useProfile } from './ProfileContext';

interface Ctx {
  state: HouseholdState;
  hydrated: boolean;
  addUserTurn: (text: string) => void;
  addAgentTurn: (text: string, chips?: string[], clarificationId?: string) => void;
  applyAI: (r: AIResponse) => void;
  markPurchased: (itemId: string) => void;
  removeItem: (itemId: string) => void;
  setInventory: (u: InventoryUpdate) => void;
  saveAsUsual: (fields: UsualFields) => void;
  forgetPreference: (productId: string) => void;
  forgetAliasPreference: (disambiguationGroup: string) => void;
  approveList: () => void;
  acceptRestock: (proposal: ProposedItem) => void;
  dismissRestock: (productId: string) => void;
  dismissPrediction: (productId: string) => void;
  setProductCategory: (productId: string, category: Category) => void;
  addItem: (item: ManualItem) => void;
  reset: () => Promise<void>;
  buildChatContext: () => ChatContext;
}

const HouseholdCtx = createContext<Ctx | null>(null);

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialHouseholdState);
  const [hydrated, setHydrated] = React.useState(false);
  // Who's holding the phone tags what they add or buy; a ref keeps the callbacks below stable.
  const { me } = useProfile();
  const by = useRef(me.id);
  by.current = me.id;

  useEffect(() => {
    let mounted = true;
    (async () => {
      const persisted = await loadPersisted();
      if (mounted && persisted) dispatch({ type: 'HYDRATE', payload: persisted });
      setHydrated(true);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    savePersisted(state);
  }, [state, hydrated]);

  const addUserTurn = useCallback((text: string) => {
    dispatch({ type: 'ADD_TURN', turn: { id: uid('t'), role: 'user', text, at: new Date().toISOString() } });
  }, []);
  const addAgentTurn = useCallback((text: string, chips?: string[], clarificationId?: string) => {
    dispatch({ type: 'ADD_TURN', turn: { id: uid('t'), role: 'agent', text, chips, clarificationId, at: new Date().toISOString() } });
  }, []);
  const applyAI = useCallback((r: AIResponse) => dispatch({ type: 'APPLY_AI', response: r, by: by.current }), []);
  const markPurchased = useCallback((itemId: string) => dispatch({ type: 'MARK_PURCHASED_BY_ID', itemId, by: by.current }), []);
  const removeItem = useCallback((itemId: string) => dispatch({ type: 'REMOVE_ITEM', itemId }), []);
  const setInventory = useCallback((u: InventoryUpdate) => dispatch({ type: 'SET_INVENTORY', update: u }), []);
  const saveAsUsual = useCallback((fields: UsualFields) => dispatch({ type: 'SAVE_AS_USUAL', fields }), []);
  const forgetPreference = useCallback((productId: string) => dispatch({ type: 'FORGET_PREFERENCE', productId }), []);
  const forgetAliasPreference = useCallback(
    (disambiguationGroup: string) => dispatch({ type: 'FORGET_ALIAS_PREFERENCE', disambiguationGroup }),
    [],
  );
  const approveList = useCallback(() => dispatch({ type: 'APPROVE_LIST' }), []);
  const acceptRestock = useCallback((proposal: ProposedItem) => dispatch({ type: 'ACCEPT_RESTOCK', proposal, by: by.current }), []);
  const dismissRestock = useCallback((productId: string) => dispatch({ type: 'DISMISS_RESTOCK', productId }), []);
  const dismissPrediction = useCallback((productId: string) => dispatch({ type: 'DISMISS_PREDICTION', productId }), []);
  const setProductCategory = useCallback(
    (productId: string, category: Category) => dispatch({ type: 'SET_PRODUCT_CATEGORY', productId, category }),
    [],
  );
  const addItem = useCallback((item: ManualItem) => dispatch({ type: 'ADD_ITEM', item, by: by.current }), []);
  const reset = useCallback(async () => {
    await clearPersisted();
    dispatch({ type: 'RESET' });
  }, []);

  const buildChatContext = useCallback((): ChatContext => buildContextFor(state), [state]);

  const value = useMemo<Ctx>(() => ({
    state, hydrated, addUserTurn, addAgentTurn, applyAI,
    markPurchased, removeItem, setInventory, saveAsUsual,
    forgetPreference, forgetAliasPreference, approveList, acceptRestock, dismissRestock, dismissPrediction, setProductCategory, addItem, reset, buildChatContext,
  }), [
    state, hydrated, addUserTurn, addAgentTurn, applyAI, markPurchased, removeItem, setInventory, saveAsUsual,
    forgetPreference, forgetAliasPreference, approveList, acceptRestock, dismissRestock, dismissPrediction, setProductCategory, addItem, reset, buildChatContext,
  ]);

  return <HouseholdCtx.Provider value={value}>{children}</HouseholdCtx.Provider>;
}

export function useHousehold(): Ctx {
  const ctx = useContext(HouseholdCtx);
  if (!ctx) throw new Error('useHousehold must be used inside HouseholdProvider');
  return ctx;
}
