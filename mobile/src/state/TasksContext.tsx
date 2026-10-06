import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProfile } from './ProfileContext';
import { migrateTask, type ArchivedTask, type Task } from './tasks';
import type { TaskPreference } from './taskMemory';
import { initialTasksState, sweepDue, tasksReducer, type NewTask, type TasksAction, type TasksState } from './tasksReducer';
import { useSyncedReducer } from '../sync/useSyncedReducer';

export type { Task } from './tasks';
export type { NewTask } from './tasksReducer';

/**
 * Family tasks from + → Task (rules in ./tasksReducer), shared with the family
 * when signed in to the server, else kept on this phone under their own
 * storage keys like the profile, so the grocery reducer stays untouched:
 * - the board (open tasks, and finished ones for KEEP_ON_BOARD_DAYS);
 * - Task history — everything that left the board, for the home's admin;
 * - task memory — who usually does what (written only on Save).
 */
const KEY = 'hearth_tasks_v1';
const ARCHIVE_KEY = 'hearth_task_archive_v1';
const MEMORY_KEY = 'hearth_task_memory_v1';
const SWEEP_EVERY_MS = 10 * 60 * 1000;

interface Ctx {
  tasks: Task[];
  archive: ArchivedTask[];
  taskPrefs: TaskPreference[];
  hydrated: boolean;
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

async function loadLocal(): Promise<TasksState> {
  const now = new Date();
  const [raw, archive, taskPrefs] = await Promise.all([
    load<any[]>(KEY, []), load<ArchivedTask[]>(ARCHIVE_KEY, []), load<TaskPreference[]>(MEMORY_KEY, []),
  ]);
  return { tasks: raw.map((t) => migrateTask(t, now)), archive, taskPrefs };
}

function saveLocal(s: TasksState) {
  AsyncStorage.multiSet([
    [KEY, JSON.stringify(s.tasks)],
    [ARCHIVE_KEY, JSON.stringify(s.archive)],
    [MEMORY_KEY, JSON.stringify(s.taskPrefs)],
  ]).catch(() => {});
}

const hydrateAction = (payload: TasksState): TasksAction => ({ type: 'HYDRATE', payload });

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const { me } = useProfile();
  const { state, dispatch, hydrated } = useSyncedReducer({
    stream: 'tasks',
    reducer: tasksReducer,
    initial: initialTasksState,
    hydrate: hydrateAction,
    loadLocal,
    saveLocal,
  });

  // Move finished (and pre-fields) tasks to history once their 3 days are up —
  // logged only when something is due, so idle phones don't fill the family's log.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const sweep = useCallback(() => {
    if (sweepDue(stateRef.current)) dispatch({ type: 'SWEEP' });
  }, [dispatch]);
  useEffect(() => {
    if (!hydrated) return;
    sweep();
    const timer = setInterval(sweep, SWEEP_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') sweep(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [hydrated, sweep]);

  const meId = useRef(me.id);
  useEffect(() => { meId.current = me.id; }, [me.id]);
  const addTask = useCallback((t: NewTask) => dispatch({ type: 'ADD_TASK', task: t, by: meId.current }), [dispatch]);
  const toggleTask = useCallback((id: string) => dispatch({ type: 'TOGGLE_TASK', id }), [dispatch]);
  const removeTask = useCallback((id: string) => dispatch({ type: 'REMOVE_TASK', id }), [dispatch]);
  const forgetTaskPref = useCallback((key: string) => dispatch({ type: 'FORGET_TASK_PREF', key }), [dispatch]);

  const value = useMemo(
    () => ({ ...state, hydrated, addTask, toggleTask, removeTask, forgetTaskPref }),
    [state, hydrated, addTask, toggleTask, removeTask, forgetTaskPref],
  );
  return <TasksCtx.Provider value={value}>{children}</TasksCtx.Provider>;
}

export function useTasks(): Ctx {
  const ctx = useContext(TasksCtx);
  if (!ctx) throw new Error('useTasks must be used inside TasksProvider');
  return ctx;
}
