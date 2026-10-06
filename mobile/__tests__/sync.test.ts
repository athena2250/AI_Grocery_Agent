import { initialHouseholdState } from '../src/data/seed';
import { reducer, type Action } from '../src/state/reducer';
import { initialTasksState, sweepDue, tasksReducer, type TasksAction } from '../src/state/tasksReducer';
import { profileReducer, type ProfileAction } from '../src/state/profileReducer';
import { DEFAULT_PROFILE } from '../src/state/profile';
import { foldRemote, seededCache, viewOf, type Envelope, type RemoteEvent, type StreamCache } from '../src/sync/log';
import type { HouseholdState } from '../src/types';

/**
 * Family sharing: two phones send events, the server orders them, and both
 * phones must end up with exactly the same state — ids and times included.
 */

const tomato = initialHouseholdState.products.find((p) => p.id === 'p_tomato') ?? initialHouseholdState.products[0];

const addTomato = (qty: number, by: string): Action => ({
  type: 'ADD_ITEM', by,
  item: { product: tomato, qty, unit: 'kg', brand: null, variant: null },
});

let n = 0;
const env = <A>(body: A, at = '2026-10-06T09:00:00.000Z'): Envelope<A> => ({ id: `ev_test_${n++}`, at, body });

/** A tiny server: orders whatever phones send. */
function server<A>() {
  const log: RemoteEvent<A>[] = [];
  return {
    push: (events: Envelope<A>[]) => {
      for (const e of events) if (!log.some((l) => l.id === e.id)) log.push({ ...e, seq: log.length + 1 });
    },
    since: (after: number) => log.filter((e) => e.seq > after),
  };
}

function phone<S, A>(householdId: string, initial: S): StreamCache<S, A> {
  return { householdId, confirmed: initial, lastSeq: 0, pending: [] };
}

const send = <S, A>(c: StreamCache<S, A>, a: A, at?: string): StreamCache<S, A> => ({ ...c, pending: [...c.pending, env(a, at)] });

describe('grocery log', () => {
  it('two phones converge to the same list, ids and times included', () => {
    const srv = server<Action>();
    let mom = phone<HouseholdState, Action>('h1', initialHouseholdState);
    let dad = phone<HouseholdState, Action>('h1', initialHouseholdState);

    mom = send(mom, addTomato(1, 'm_mom'), '2026-10-06T09:00:00.000Z');
    dad = send(dad, addTomato(2, 'm_dad'), '2026-10-06T09:00:01.000Z');
    // Each sees its own change at once, before the server answers.
    expect(viewOf(reducer, mom).listItems.some((li) => li.productId === tomato.id)).toBe(true);

    srv.push(dad.pending);
    srv.push(mom.pending);
    mom = foldRemote(reducer, mom, srv.since(mom.lastSeq));
    dad = foldRemote(reducer, dad, srv.since(dad.lastSeq));

    expect(mom.pending).toEqual([]);
    expect(dad.pending).toEqual([]);
    expect(viewOf(reducer, mom)).toEqual(viewOf(reducer, dad));
  });

  it('a tick from one phone finds the row another phone added', () => {
    const srv = server<Action>();
    let mom = send(phone<HouseholdState, Action>('h1', initialHouseholdState), addTomato(1, 'm_mom'));
    srv.push(mom.pending);
    mom = foldRemote(reducer, mom, srv.since(0));
    let dad = foldRemote(reducer, phone<HouseholdState, Action>('h1', initialHouseholdState), srv.since(0));

    const row = viewOf(reducer, dad).listItems.find((li) => li.productId === tomato.id && li.status === 'pending')!;
    dad = send(dad, { type: 'MARK_PURCHASED_BY_ID', itemId: row.id, by: 'm_dad' });
    srv.push(dad.pending);
    mom = foldRemote(reducer, mom, srv.since(mom.lastSeq));

    expect(viewOf(reducer, mom).listItems.find((li) => li.id === row.id)?.status).toBe('purchased');
    expect(viewOf(reducer, mom).history[0]).toMatchObject({ productId: tomato.id, memberId: 'm_dad' });
  });

  it('events already folded are not applied twice', () => {
    const srv = server<Action>();
    const mom = send(phone<HouseholdState, Action>('h1', initialHouseholdState), addTomato(1, 'm_mom'));
    srv.push(mom.pending);
    const once = foldRemote(reducer, mom, srv.since(0));
    expect(foldRemote(reducer, once, srv.since(0))).toBe(once);
  });

  it('a new home starts from what the phone already had', () => {
    const before = reducer(initialHouseholdState, addTomato(3, 'm_mom'));
    const c = seededCache<HouseholdState, Action>('h1', initialHouseholdState, before, (payload) => ({ type: 'HYDRATE', payload }), env);
    expect(viewOf(reducer, c)).toEqual(before);
    expect(seededCache<HouseholdState, Action>('h1', initialHouseholdState, null, (p) => ({ type: 'HYDRATE', payload: p }), env).pending).toEqual([]);
  });
});

describe('tasks log', () => {
  const task = { title: 'Fix the tap', section: 'Home Repairs', kind: 'task', notes: '', whoId: 'm_dad', due: null, details: {} } as any;

  it('replays the same on every phone', () => {
    const srv = server<TasksAction>();
    let a = send(phone<typeof initialTasksState, TasksAction>('h1', initialTasksState), { type: 'ADD_TASK', task, by: 'm_mom' }, '2026-10-01T09:00:00.000Z');
    srv.push(a.pending);
    a = foldRemote(tasksReducer, a, srv.since(0));
    const id = viewOf(tasksReducer, a).tasks[0].id;
    a = send(a, { type: 'TOGGLE_TASK', id }, '2026-10-01T10:00:00.000Z');
    srv.push(a.pending);
    a = foldRemote(tasksReducer, a, srv.since(a.lastSeq));
    const b = foldRemote(tasksReducer, phone<typeof initialTasksState, TasksAction>('h1', initialTasksState), srv.since(0));

    expect(viewOf(tasksReducer, b)).toEqual(viewOf(tasksReducer, a));
    expect(viewOf(tasksReducer, b).tasks[0]).toMatchObject({ done: true, doneAt: '2026-10-01T10:00:00.000Z', createdBy: 'm_mom' });
  });

  it('sweeps finished tasks to history only when due', () => {
    const s1 = tasksReducer(initialTasksState, { type: 'ADD_TASK', task, by: 'm_mom' });
    const s2 = tasksReducer(s1, { type: 'TOGGLE_TASK', id: s1.tasks[0].id });
    expect(sweepDue(s2, new Date())).toBe(false);
    const later = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    expect(sweepDue(s2, later)).toBe(true);
  });
});

describe('profile log', () => {
  it('members and setup are shared; ids come from the event', () => {
    const actions: ProfileAction[] = [
      { type: 'TOGGLE_MEMBER', id: 'm_ananya' },
      { type: 'FINISH_ONBOARDING', meId: 'm_mom' },
      { type: 'LINK_ACCOUNT', account: { phone: '+919876543210', name: 'Priya', relation: 'Mom', createdAt: '' }, meId: 'm_mom' },
    ];
    const a = actions.reduce(profileReducer, DEFAULT_PROFILE);
    const b = actions.reduce(profileReducer, DEFAULT_PROFILE);
    expect(a).toEqual(b);
    expect(a.onboarded).toBe(true);
    expect(a.ownerId).toBe('m_mom');
    expect(a.members.find((m) => m.id === 'm_ananya')?.on).toBe(false);
    expect(a.members.find((m) => m.phone === '+919876543210')?.name).toBe('Priya');
  });
});
