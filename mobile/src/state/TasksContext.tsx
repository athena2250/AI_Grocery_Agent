import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProfile } from './ProfileContext';
import type { Task } from './tasks';

export type { Task } from './tasks';

/**
 * Family tasks added from the + sheet, kept under their own storage key like
 * the profile, so the grocery reducer and its migrations stay untouched.
 */
const KEY = 'hearth_tasks_v1';

interface Ctx {
  tasks: Task[];
  addTask: (t: Omit<Task, 'id' | 'createdAt' | 'createdBy' | 'done'>) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
}

const TasksCtx = createContext<Ctx | null>(null);

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const { me } = useProfile();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (mounted && raw) setTasks(JSON.parse(raw));
      } catch {
        // start empty
      }
      if (mounted) setHydrated(true);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(KEY, JSON.stringify(tasks)).catch(() => {});
  }, [tasks, hydrated]);

  const addTask = useCallback<Ctx['addTask']>((t) => {
    const id = `task_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setTasks((prev) => [{ ...t, id, createdAt: new Date().toISOString(), createdBy: me.id, done: false }, ...prev]);
  }, [me.id]);
  const toggleTask = useCallback((id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }, []);
  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ tasks, addTask, toggleTask, removeTask }), [tasks, addTask, toggleTask, removeTask]);
  return <TasksCtx.Provider value={value}>{children}</TasksCtx.Provider>;
}

export function useTasks(): Ctx {
  const ctx = useContext(TasksCtx);
  if (!ctx) throw new Error('useTasks must be used inside TasksProvider');
  return ctx;
}
