import { initialHouseholdState } from '../src/data/seed';
import { TASK_CATALOG } from '../src/data/taskCatalog';
import { draftFromText, identifyTask, withCatalog } from '../src/state/identifyTask';
import {
  KIND_FIELDS, answer, draftToTask, fieldsFor, isComplete, missingFields, missingLabels, nextQuestion, withSection,
} from '../src/state/taskFields';
import { learnTask, suggestedWho, SUGGEST_AFTER, type TaskPreference } from '../src/state/taskMemory';
import { splitMessage } from '../src/state/splitMessage';

// Monday 5 Oct 2026.
const now = new Date(2026, 9, 5);
const people = [
  { id: 'm1', name: 'Lakshmi', relation: 'Mom' },
  { id: 'm2', name: 'Ravi', relation: 'Dad' },
];
const entry = (id: string) => TASK_CATALOG.find((e) => e.id === id)!;
const ids = (text: string) => identifyTask(text)?.candidates.map((e) => e.id);
const field = (kind: keyof typeof KIND_FIELDS, key: string) => KIND_FIELDS[kind].find((f) => f.key === key)!;

describe('KIND_FIELDS mirrors backend POST_KIND_FIELDS', () => {
  it.each([
    ['task', ['what', 'assigned_to', 'needed_by']],
    ['bill', ['bill_type', 'amount', 'due_date', 'assigned_to']],
    ['appointment', ['what', 'appointment_date', 'appointment_time']],
    ['errand', ['what', 'assigned_to', 'needed_by']],
    ['ticket_booking', ['from', 'to', 'travel_date', 'passengers', 'assigned_to']],
    ['shopping', ['item', 'assigned_to']],
    ['misc', ['what']],
  ] as const)('%s requires %j', (kind, keys) => {
    expect(KIND_FIELDS[kind].filter((f) => f.required).map((f) => f.key)).toEqual(keys);
  });
});

describe('identifyTask — Add task, page 1', () => {
  it('finds a common task by what she calls it', () => {
    expect(ids('kitchen tap leaking')).toEqual(['t_plumber']);
    expect(ids('pay the current bill')).toEqual(['t_eb']);
    expect(ids('book gas cylinder')).toEqual(['t_gas']);
  });

  it('asks which one when the words fit two tasks (like coriander)', () => {
    expect(ids('ac')).toEqual(['t_ac_repair', 't_ac_service']);
    expect(ids('gas')).toEqual(['t_gas_bill', 't_gas']);
  });

  it('the longest phrase decides', () => {
    expect(ids('ac service')).toEqual(['t_ac_service']);
    expect(ids('gas bill')).toEqual(['t_gas_bill']);
  });

  it('outside the catalog: only a keyword guess for the section chip', () => {
    expect(identifyTask('buy a new mixer')).toEqual({ text: 'buy a new mixer', candidates: [], guess: 'Shopping' });
    expect(identifyTask('the thing')).toEqual({ text: 'the thing', candidates: [] });
  });
});

describe('draftFromText', () => {
  it('fills only what the words say', () => {
    const d = draftFromText('ask Dad to call the plumber tomorrow', people, 'm1', now);
    expect(d).toMatchObject({ section: 'Home Repair', catalogId: 't_plumber', whoId: 'm2', due: '2026-10-06', details: {} });
    expect(isComplete(d)).toBe(true);
  });

  it('a catalog name can answer a field, but never who, when or how much', () => {
    const d = draftFromText('current bill', people, 'm1', now);
    expect(d.details).toEqual({ bill_type: 'Electricity' });
    expect(missingFields(d).map((f) => f.key)).toEqual(['due_date', 'amount', 'assigned_to']);
  });

  it('a said time joins the deadline, or the appointment time', () => {
    expect(draftFromText('call plumber tomorrow at 5pm', people, 'm1', now).due).toBe('2026-10-06T17:00');
    const dentist = draftFromText('dentist tomorrow at 10:30 am', people, 'm1', now);
    expect(dentist).toMatchObject({ due: '2026-10-06', details: { appointment_time: '10:30' } });
  });

  it('a time with no date waits for the date', () => {
    const d = draftFromText('call plumber at 5pm', people, 'm1', now);
    expect(d).toMatchObject({ due: undefined, pendingTime: '17:00' });
    expect(answer(d, field('task', 'needed_by'), '2026-10-07').due).toBe('2026-10-07T17:00');
  });

  it('ambiguous words leave the kind to her', () => {
    const d = draftFromText('look at the ac', people, 'm1', now);
    expect(d.section).toBeNull();
    expect(missingLabels(d)).toEqual(['which kind']);
    const picked = withCatalog(withSection(d, 'Home Repair'), entry('t_ac_repair'));
    expect(picked).toMatchObject({ section: 'Home Repair', catalogId: 't_ac_repair' });
  });
});

describe('answering fields', () => {
  const base = draftFromText('pay the internet bill', people, 'm1', now);

  it('asks in backend order: what it is, when, how much, who', () => {
    expect(nextQuestion(base)?.key).toBe('due_date');
    const d1 = answer(base, field('bill', 'due_date'), '2026-10-10');
    expect(nextQuestion(d1)?.key).toBe('amount');
    const d2 = answer(d1, field('bill', 'amount'), '799');
    expect(nextQuestion(d2)?.key).toBe('assigned_to');
    const d3 = answer(d2, field('bill', 'assigned_to'), 'm2');
    expect(isComplete(d3)).toBe(true);
    expect(draftToTask(d3)).toMatchObject({
      title: 'Pay the internet bill', section: 'Bills & Payments', kind: 'bill', whoId: 'm2', due: '2026-10-10',
      details: { bill_type: 'Internet', amount: '799' }, catalogId: 't_internet',
    });
  });

  it('a bill can not be "no rush"; a repair can', () => {
    expect(field('bill', 'due_date').noRush).toBeFalsy();
    expect(field('task', 'needed_by').noRush).toBe(true);
  });

  it('undefined clears an answer', () => {
    const d = answer(base, field('bill', 'due_date'), '2026-10-10');
    expect(answer(d, field('bill', 'due_date'), undefined).due).toBeUndefined();
  });

  it('an incomplete draft can not be saved', () => expect(draftToTask(base)).toBeNull());

  it('optional dates save as no rush', () => {
    const d = answer(draftFromText('note: grandma visiting', people, 'm1', now), field('misc', 'what'), 'Grandma visiting');
    const misc = withSection(d, 'Miscellaneous');
    expect(draftToTask(misc)).toMatchObject({ kind: 'misc', due: null, whoId: null });
  });

  it('switching section drops fields the new kind does not have', () => {
    const bill = answer(base, field('bill', 'amount'), '799');
    const errand = withSection(bill, 'Errands');
    expect(errand.details).toEqual({});
    expect(fieldsFor(errand).map((f) => f.key)).toEqual(['what', 'assigned_to', 'needed_by', 'location']);
  });
});

describe('task memory — suggests, never picks', () => {
  const plumber = { catalogId: 't_plumber', section: 'Home Repair' as const };
  const learn = (prefs: TaskPreference[], whoId: string) => learnTask(prefs, { ...plumber, whoId }, now);

  it(`marks someone only after ${SUGGEST_AFTER} saves with them`, () => {
    const once = learn([], 'm2');
    expect(suggestedWho(once, plumber, ['m1', 'm2'])).toBeNull();
    const twice = learn(once, 'm2');
    expect(suggestedWho(twice, plumber, ['m1', 'm2'])).toBe('m2');
    expect(twice[0]).toMatchObject({ label: 'Call the plumber', counts: { m2: 2 } });
  });

  it('choosing someone else counts for them; a tie suggests nobody', () => {
    const p = learn(learn(learn(learn([], 'm2'), 'm2'), 'm1'), 'm1');
    expect(suggestedWho(p, plumber, ['m1', 'm2'])).toBeNull();
    expect(suggestedWho(learn(p, 'm1'), plumber, ['m1', 'm2'])).toBe('m1');
  });

  it('a draft that already names someone is left alone — the memory only marks a chip', () => {
    const prefs = learn(learn([], 'm2'), 'm2');
    const d = draftFromText('Mom will call the plumber', people, 'm1', now);
    expect(d.whoId).toBe('m1');
    expect(suggestedWho(prefs, d, ['m1', 'm2'])).toBe('m2');
  });

  it('tasks outside the catalog learn by section; nobody assigned teaches nothing', () => {
    const p = learnTask([], { section: 'Shopping', whoId: 'm1' }, now);
    expect(p[0].key).toBe('section:Shopping');
    expect(learnTask([], { section: 'Shopping', whoId: null }, now)).toEqual([]);
  });

  it('someone no longer in the home is not suggested', () => {
    const prefs = learn(learn([], 'm2'), 'm2');
    expect(suggestedWho(prefs, plumber, ['m1'])).toBeNull();
  });
});

describe('splitMessage — one Type or speak for both', () => {
  const s = initialHouseholdState;

  it('groceries and a task in one message', () => {
    expect(splitMessage('get tomatoes and call the plumber tomorrow', s))
      .toEqual({ grocery: 'get tomatoes', tasks: ['call the plumber tomorrow'] });
  });

  it('grocery-only messages pass through untouched', () => {
    expect(splitMessage('get coriander', s)).toEqual({ grocery: 'get coriander', tasks: [] });
    expect(splitMessage('rice is almost finished', s)).toEqual({ grocery: 'rice is almost finished', tasks: [] });
    expect(splitMessage('tomatoes and coriander', s)).toEqual({ grocery: 'tomatoes and coriander', tasks: [] });
  });

  it('a catalog task phrase beats a grocery word; a grocery product beats a loose keyword', () => {
    expect(splitMessage('pay the milk bill', s).tasks).toEqual(['pay the milk bill']);
    expect(splitMessage('order rice', s)).toEqual({ grocery: 'order rice', tasks: [] });
  });

  it('several tasks, and short leftovers join the task beside them', () => {
    expect(splitMessage('pay rent, book gas and fix the fan tomorrow', s).tasks)
      .toEqual(['pay rent', 'book gas', 'fix the fan tomorrow']);
    expect(splitMessage('call the electrician, tomorrow', s).tasks).toEqual(['call the electrician tomorrow']);
  });
});
