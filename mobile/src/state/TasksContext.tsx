import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProfile } from './ProfileContext';
import { migrateTask, sweepTasks, type ArchivedTask, type Task } from './tasks';
import { forgetTaskPreference, learnTask, type TaskPreference } from './taskMemory';

export type { Task } from './tasks';

/**
 * Family tasks from + → Task, under their own storage keys like the profile,
 * so the grocery reducer and its migrations stay untouched:
 * - the board (open tasks, and finished ones for KEEP_ON_BOARD_DAYS);
 * - Task history — everything that left the board, for the home's admin;
 * - task memory — who usually does what (written only on Save).
 */
const KEY = 'hearth_tasks_v1';
const ARCHIVE_KEY = 'hearth_task_archive_v1';
const MEMORY_KEY = 'hearth_task_memory_v1';
const SWEEP_EVERY_MS = 10 * 60 * 1000;

export type NewTask = Omit<Task, 'id' | 'createdAt' | 'createdBy' | 'done' | 'doneAt'>;

interface Ctx {
  tasks: Task[];
  archive: ArchivedTask[];
  taskPrefs: TaskPreference[];
  addTask: (t: NewTask) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
  forgetTaskPref: (key: string) => void;
}

const TasksCtx = createContext<Ctx | null>(null);

async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const { me } = useProfile();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [archive, setArchive] = useState<ArchivedTask[]>([]);
  const [taskPrefs, setTaskPrefs] = useState<TaskPreference[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const now = new Date();
      const [raw, arch, prefs] = await Promise.all([
        load<any[]>(KEY, []), load<ArchivedTask[]>(ARCHIVE_KEY, []), load<TaskPreference[]>(MEMORY_KEY, []),
      ]);
      if (!mounted) return;
      setTasks(raw.map((t) => migrateTask(t, now)));
      setArchive(arch);
      setTaskPrefs(prefs);
      setHydrated(true);
    })();
    return () => { mounted = false; };
  }, []);

  // Move finished (and pre-fields) tasks to history once their 3 days are up.
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  const sweep = useCallback(() => {
    const { archived } = sweepTasks(tasksRef.current);
    if (!archived.length) return;
    const ids = new Set(archived.map((t) => t.id));
    setTasks((prev) => prev.filter((t) => !ids.has(t.id)));
    setArchive((prev) => [...archived, ...prev.filter((t) => !ids.has(t.id))]);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    sweep();
    const timer = setInterval(sweep, SWEEP_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') sweep(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [hydrated, sweep]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(KEY, JSON.stringify(tasks)).catch(() => {});
  }, [tasks, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive)).catch(() => {});
  }, [archive, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(taskPrefs)).catch(() => {});
  }, [taskPrefs, hydrated]);

  const addTask = useCallback<Ctx['addTask']>((t) => {
    const id = `task_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setTasks((prev) => [{ ...t, id, createdAt: new Date().toISOString(), createdBy: me.id, done: false, doneAt: null }, ...prev]);
    // Saving is the confirmation — the only place task memory learns.
    setTaskPrefs((prev) => learnTask(prev, t));
  }, [me.id]);
  const toggleTask = useCallback((id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id
      ? { ...t, done: !t.done, doneAt: t.done ? null : new Date().toISOString() }
      : t)));
  }, []);
  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const forgetTaskPref = useCallback((key: string) => setTaskPrefs((prev) => forgetTaskPreference(prev, key)), []);

  const value = useMemo(
    () => ({ tasks, archive, taskPrefs, addTask, toggleTask, removeTask, forgetTaskPref }),
    [tasks, archive, taskPrefs, addTask, toggleTask, removeTask, forgetTaskPref],
  );
  return <TasksCtx.Provider value={value}>{children}</TasksCtx.Provider>;
}

export function useTasks(): Ctx {
  const ctx = useContext(TasksCtx);
  if (!ctx) throw new Error('useTasks must be used inside TasksProvider');
  return ctx;
}
