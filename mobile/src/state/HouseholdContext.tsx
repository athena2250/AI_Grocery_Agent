import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { AIResponse, Category, ChatContext, HouseholdState, InventoryUpdate, ProposedItem } from '../types';
import { initialHouseholdState } from '../data/seed';
import { loadPersisted, savePersisted, clearPersisted } from './persistence';
import { buildChatContext as buildContextFor, reducer, uid, type Action, type ManualItem } from './reducer';
import { useSyncedReducer } from '../sync/useSyncedReducer';
import type { UsualFields } from './memory';
import { useProfile } from './ProfileContext';

const hydrateAction = (payload: HouseholdState): Action => ({ type: 'HYDRATE', payload });

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
  // Shared with the family when signed in to the server (src/sync); this phone only in the sandbox.
  const { state, dispatch, hydrated, shared, clearShared } = useSyncedReducer({
    stream: 'grocery',
    reducer,
    initial: initialHouseholdState,
    hydrate: hydrateAction,
    loadLocal: loadPersisted,
    saveLocal: savePersisted,
  });
  // Who's holding the phone tags what they add or buy; a ref keeps the callbacks below stable.
  const { me } = useProfile();
  const by = useRef(me.id);
  useEffect(() => { by.current = me.id; }, [me.id]);

  const addUserTurn = useCallback((text: string) => {
    dispatch({ type: 'ADD_TURN', turn: { id: uid('t'), role: 'user', text, at: new Date().toISOString() } });
  }, [dispatch]);
  const addAgentTurn = useCallback((text: string, chips?: string[], clarificationId?: string) => {
    dispatch({ type: 'ADD_TURN', turn: { id: uid('t'), role: 'agent', text, chips, clarificationId, at: new Date().toISOString() } });
  }, [dispatch]);
  const applyAI = useCallback((r: AIResponse) => dispatch({ type: 'APPLY_AI', response: r, by: by.current }), [dispatch]);
  const markPurchased = useCallback((itemId: string) => dispatch({ type: 'MARK_PURCHASED_BY_ID', itemId, by: by.current }), [dispatch]);
  const removeItem = useCallback((itemId: string) => dispatch({ type: 'REMOVE_ITEM', itemId }), [dispatch]);
  const setInventory = useCallback((u: InventoryUpdate) => dispatch({ type: 'SET_INVENTORY', update: u }), [dispatch]);
  const saveAsUsual = useCallback((fields: UsualFields) => dispatch({ type: 'SAVE_AS_USUAL', fields }), [dispatch]);
  const forgetPreference = useCallback((productId: string) => dispatch({ type: 'FORGET_PREFERENCE', productId }), [dispatch]);
  const forgetAliasPreference = useCallback(
    (disambiguationGroup: string) => dispatch({ type: 'FORGET_ALIAS_PREFERENCE', disambiguationGroup }),
    [dispatch],
  );
  const approveList = useCallback(() => dispatch({ type: 'APPROVE_LIST' }), [dispatch]);
  const acceptRestock = useCallback((proposal: ProposedItem) => dispatch({ type: 'ACCEPT_RESTOCK', proposal, by: by.current }), [dispatch]);
  const dismissRestock = useCallback((productId: string) => dispatch({ type: 'DISMISS_RESTOCK', productId }), [dispatch]);
  const dismissPrediction = useCallback((productId: string) => dispatch({ type: 'DISMISS_PREDICTION', productId }), [dispatch]);
  const setProductCategory = useCallback(
    (productId: string, category: Category) => dispatch({ type: 'SET_PRODUCT_CATEGORY', productId, category }),
    [dispatch],
  );
  const addItem = useCallback((item: ManualItem) => dispatch({ type: 'ADD_ITEM', item, by: by.current }), [dispatch]);
  // Signed in, this only forgets the phone's copy — never the family's list.
  const reset = useCallback(async () => {
    if (shared) { await clearShared(); return; }
    await clearPersisted();
    dispatch({ type: 'RESET' });
  }, [shared, clearShared, dispatch]);

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
