import {
  daysLeftOnBoard, dueFor, dueLabel, isOverdue, migrateTask, monthGrid, sectionFor, sweepTasks, timeFor, whoFor,
  type Task,
} from '../src/state/tasks';

// Monday 5 Oct 2026.
const now = new Date(2026, 9, 5);
const people = [
  { id: 'm1', name: 'Lakshmi', relation: 'Mom' },
  { id: 'm2', name: 'Ravi', relation: 'Dad' },
];

describe('sectionFor', () => {
  it.each([
    ['kitchen tap is leaking', 'Home Repair'],
    ['pay the current bill', 'Bills & Payments'],
    ['book train tickets to Vizag', 'Tickets'],
    ['dentist for Aarav', 'Appointments'],
    ['AC servicing', 'Maintenance'],
    ['discuss summer holiday', 'Discussions'],
  ])('%s → %s', (text, section) => expect(sectionFor(text)).toBe(section));

  it('does not guess when no word matches', () => expect(sectionFor('the thing')).toBeNull());
});

describe('dueFor', () => {
  it('reads relative days', () => {
    expect(dueFor('by tomorrow', now)).toBe('2026-10-06');
    expect(dueFor('day after tomorrow', now)).toBe('2026-10-07');
    expect(dueFor('by friday', now)).toBe('2026-10-09');
    expect(dueFor('today please', now)).toBe('2026-10-05');
    expect(dueFor('this weekend', now)).toBe('2026-10-10');
  });
  it('treats "no rush" as an answer, silence as missing', () => {
    expect(dueFor('no rush', now)).toBeNull();
    expect(dueFor('call the plumber', now)).toBeUndefined();
  });
});

describe('whoFor', () => {
  it('matches a name or relation', () => {
    expect(whoFor('ask Dad to call', people, 'm1')).toBe('m2');
    expect(whoFor('Lakshmi will go', people, 'm2')).toBe('m1');
  });
  it('"I will" means whoever is typing', () => expect(whoFor("I'll do it", people, 'm2')).toBe('m2'));
  it('asks rather than guesses', () => expect(whoFor('call the plumber', people, 'm1')).toBeNull());
});

describe('timeFor', () => {
  it.each([
    ['at 5pm', '17:00'],
    ['10:30 am', '10:30'],
    ['by 12 pm', '12:00'],
    ['12am', '00:00'],
    ['at 17:45', '17:45'],
  ])('%s → %s', (text, time) => expect(timeFor(text)).toBe(time));
  it('does not read a bare "at 5" (morning or evening?)', () => expect(timeFor('at 5')).toBeUndefined());
});

describe('deadlines', () => {
  it('labels a date and a time', () => {
    expect(dueLabel('2026-10-05', now)).toBe('Today');
    expect(dueLabel('2026-10-06T17:30', now)).toBe('Tomorrow · 5:30 pm');
    expect(dueLabel('2026-10-10', now)).toBe('Sat 10 Oct');
    expect(dueLabel(null, now)).toBe('No rush');
  });
  it('a date-only deadline lasts the day; a timed one ends at its time', () => {
    const noon = new Date(2026, 9, 5, 12, 0);
    expect(isOverdue('2026-10-05', noon)).toBe(false);
    expect(isOverdue('2026-10-04', noon)).toBe(true);
    expect(isOverdue('2026-10-05T11:00', noon)).toBe(true);
    expect(isOverdue('2026-10-05T13:00', noon)).toBe(false);
    expect(isOverdue(null, noon)).toBe(false);
  });
  it('builds a Sunday-first month', () => {
    const weeks = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(weeks[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

describe('the board: 3 days, then Task history', () => {
  const base: Task = {
    id: 't1', title: 'Call the plumber', section: 'Home Repair', kind: 'task', notes: '', whoId: 'm2',
    due: '2026-10-06', details: {}, createdAt: '2026-10-01T10:00:00.000Z', createdBy: 'm1', done: false, doneAt: null,
  };
  const at = (iso: string) => new Date(iso);

  it('keeps open tasks however old', () => {
    expect(sweepTasks([base], at('2027-01-01T00:00:00.000Z')).archived).toEqual([]);
    expect(daysLeftOnBoard(base)).toBeNull();
  });

  it('a finished task stays 3 days, then is archived as done', () => {
    const done = { ...base, done: true, doneAt: '2026-10-05T10:00:00.000Z' };
    expect(sweepTasks([done], at('2026-10-08T09:59:00.000Z')).active).toHaveLength(1);
    const { active, archived } = sweepTasks([done], at('2026-10-08T10:00:00.000Z'));
    expect(active).toEqual([]);
    expect(archived[0]).toMatchObject({ id: 't1', reason: 'done', archivedAt: '2026-10-08T10:00:00.000Z' });
    expect(daysLeftOnBoard(done, new Date(2026, 9, 5, 12))).toBe(3);
    expect(daysLeftOnBoard({ ...done, doneAt: new Date(2026, 9, 2, 9).toISOString() }, new Date(2026, 9, 5, 8))).toBe(0);
  });

  it('un-ticking puts it back on the board for good', () => {
    const reopened = { ...base, done: false, doneAt: null };
    expect(sweepTasks([reopened], at('2026-12-01T00:00:00.000Z')).active).toHaveLength(1);
  });

  it('tasks saved before fields get fields and leave 3 days after the upgrade', () => {
    const upgrade = at('2026-10-06T08:00:00.000Z');
    const old = migrateTask({ id: 'v1', title: 'Fix fan', section: 'Home Repair', notes: '', whoId: 'm2', due: null, createdAt: '2026-09-30T00:00:00.000Z', createdBy: 'm1', done: false }, upgrade);
    expect(old).toMatchObject({ kind: 'task', details: {}, doneAt: null, legacyRetireAt: '2026-10-09T08:00:00.000Z' });
    expect(sweepTasks([old], at('2026-10-09T07:00:00.000Z')).active).toHaveLength(1);
    expect(sweepTasks([old], at('2026-10-09T08:00:00.000Z')).archived[0].reason).toBe('legacy');
  });

  it('migrating a current task changes nothing', () => {
    expect(migrateTask(base)).toEqual(base);
  });
});
