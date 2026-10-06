import { clock, uid } from './eventClock';
import { sweepTasks, type ArchivedTask, type Task } from './tasks';
import { forgetTaskPreference, learnTask, type TaskPreference } from './taskMemory';

/**
 * The family's tasks as one pure reducer, so every phone replaying the shared
 * log (src/sync) ends up with the same board. Time and new ids come from
 * eventClock: the event's own when replaying.
 */
export interface TasksState {
  /** The board: open tasks, and finished ones for KEEP_ON_BOARD_DAYS. */
  tasks: Task[];
  /** Task history — everything that left the board, for the home's admin. */
  archive: ArchivedTask[];
  /** Who usually does what — written only on Save. */
  taskPrefs: TaskPreference[];
}

export type NewTask = Omit<Task, 'id' | 'createdAt' | 'createdBy' | 'done' | 'doneAt'>;

export type TasksAction =
  | { type: 'HYDRATE'; payload: TasksState }
  | { type: 'ADD_TASK'; task: NewTask; by: string }
  | { type: 'TOGGLE_TASK'; id: string }
  | { type: 'REMOVE_TASK'; id: string }
  | { type: 'FORGET_TASK_PREF'; key: string }
  /** Move finished tasks to history once their days on the board are up. */
  | { type: 'SWEEP' };

export const initialTasksState: TasksState = { tasks: [], archive: [], taskPrefs: [] };

export function tasksReducer(state: TasksState, action: TasksAction): TasksState {
  switch (action.type) {
    case 'HYDRATE':
      return action.payload;
    case 'ADD_TASK': {
      const now = clock();
      const task: Task = { ...action.task, id: uid('task'), createdAt: now.toISOString(), createdBy: action.by, done: false, doneAt: null };
      // Saving is the confirmation — the only place task memory learns.
      return { ...state, tasks: [task, ...state.tasks], taskPrefs: learnTask(state.taskPrefs, action.task, now) };
    }
    case 'TOGGLE_TASK': {
      if (!state.tasks.some((t) => t.id === action.id)) return state;
      const at = clock().toISOString();
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, done: !t.done, doneAt: t.done ? null : at } : t)),
      };
    }
    case 'REMOVE_TASK':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };
    case 'FORGET_TASK_PREF':
      return { ...state, taskPrefs: forgetTaskPreference(state.taskPrefs, action.key) };
    case 'SWEEP': {
      const { active, archived } = sweepTasks(state.tasks, clock());
      if (!archived.length) return state;
      const ids = new Set(archived.map((t) => t.id));
      return { ...state, tasks: active, archive: [...archived, ...state.archive.filter((t) => !ids.has(t.id))] };
    }
    default:
      return state;
  }
}

/** Would a sweep move anything right now? (So phones only log a SWEEP when it matters.) */
export const sweepDue = (state: TasksState, now: Date = new Date()) => sweepTasks(state.tasks, now).archived.length > 0;
