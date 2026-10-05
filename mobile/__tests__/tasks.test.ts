import { dueFor, fillTask, sectionFor, whoFor, withMissing } from '../src/state/tasks';

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

describe('fillTask', () => {
  it('fills what the words say and leaves the rest missing', () => {
    const d = fillTask({ title: 'kitchen tap is leaking', section: null, info: 'call the plumber' }, people, 'm1', now);
    expect(d).toMatchObject({ title: 'Kitchen tap is leaking', section: 'Home Repair', sectionFromAI: true, whoId: null });
    expect(d.missing).toEqual(['who', 'due']);
  });

  it('an explicit section beats the keywords', () => {
    const d = fillTask({ title: 'fix the fan', section: 'Discussions', info: 'Dad, by Saturday' }, people, 'm1', now);
    expect(d).toMatchObject({ section: 'Discussions', sectionFromAI: false, whoId: 'm2', due: '2026-10-10', missing: [] });
  });

  it('answering clears what is missing', () => {
    const d = fillTask({ title: 'something', section: null, info: '' }, people, 'm1', now);
    expect(d.missing).toEqual(['section', 'who', 'due']);
    expect(withMissing({ ...d, section: 'Errands', whoId: 'm1', due: null }).missing).toEqual([]);
  });
});
