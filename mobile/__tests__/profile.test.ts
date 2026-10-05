import { MockAIService } from '../src/services/MockAIService';
import { buildChatContext, reducer } from '../src/state/reducer';
import { initialHouseholdState } from '../src/data/seed';
import {
  DEFAULT_PROFILE, currentMe, localPhone, memberActivity, migrateProfile, normalizePhone, phoneDigits,
} from '../src/state/profile';
import type { HouseholdState } from '../src/types';

const ai = new MockAIService();

async function say(state: HouseholdState, text: string, by?: string, clarificationId?: string) {
  const r = await ai.chat(text, buildChatContext(state, clarificationId));
  return { r, state: reducer(state, { type: 'APPLY_AI', response: r, by }) };
}

describe('normalizePhone', () => {
  it.each([
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
  ])('%s → %s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it('blank clears the number', () => expect(normalizePhone('  ')).toBeNull());

  it.each(['12345', '98765432101234', '1234567890'])('%s is invalid', (input) => {
    expect(normalizePhone(input)).toBe('invalid');
  });

  it('shows the local part', () => expect(localPhone('+919876543210')).toBe('9876543210'));
});

describe('phoneDigits (what the field accepts while typing)', () => {
  it.each([
    ['98abc76', '9876'],
    ['98765-43210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['098765 43210', '9876543210'],
    ['98765432109999', '9876543210'],
    ['hello', ''],
  ])('%s → %s', (input, out) => expect(phoneDigits(input)).toBe(out));
});

describe('migrateProfile', () => {
  const v1 = {
    onboarded: true,
    members: [
      { name: 'Lakshmi', role: 'Mom', color: '#9C4A2F', on: false },
      { name: 'Ravi', role: 'Dad', color: '#3E5C63', on: true },
      { name: 'Ananya', role: 'Me', color: '#5B6B45', on: true },
      { name: 'Aarav', role: 'Son', color: '#6A5A73', on: true },
    ],
    manage: DEFAULT_PROFILE.manage,
  };

  it('gives v1 members ids, relations and empty diet', () => {
    const p = migrateProfile(v1);
    expect(p.members.map((m) => m.id)).toEqual(['m_mom', 'm_dad', 'm_ananya', 'm_aarav']);
    expect(p.members.map((m) => m.relation)).toEqual(['Mom', 'Dad', 'Daughter', 'Son']);
    expect(p.members[1]).toMatchObject({ phone: null, diet: null, dietFlags: [], allergies: [], dietNote: '' });
  });

  it('keeps the old "first ticked is me" rule and makes them owner', () => {
    const p = migrateProfile(v1);
    expect(p.meId).toBe('m_dad');
    expect(p.ownerId).toBe('m_dad');
  });

  it('a not-yet-onboarded profile has no me/owner', () => {
    const p = migrateProfile({ ...v1, onboarded: false });
    expect(p.meId).toBeNull();
    expect(p.ownerId).toBeNull();
  });

  it('round-trips a current profile', () => {
    const p = migrateProfile(v1);
    expect(migrateProfile(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('garbage falls back to defaults', () => expect(migrateProfile('nope')).toBe(DEFAULT_PROFILE));
});

describe('currentMe', () => {
  it('falls back to the first ticked person when "me" left the home', () => {
    const p = { ...DEFAULT_PROFILE, meId: 'm_mom', members: DEFAULT_PROFILE.members.map((m) => ({ ...m, on: m.id !== 'm_mom' })) };
    expect(currentMe(p).id).toBe('m_dad');
  });
});

describe('tagging who added and bought', () => {
  it('tags new list items and the purchase with the member', async () => {
    let { state } = await say(initialHouseholdState, 'get tomatoes 1 kg', 'm_mom');
    const tomato = state.listItems.find((li) => li.productId === 'p_tomato');
    expect(tomato?.addedByMemberId).toBe('m_mom');

    state = reducer(state, { type: 'MARK_PURCHASED_BY_ID', itemId: tomato!.id, by: 'm_dad' });
    expect(state.history[0]).toMatchObject({ productId: 'p_tomato', memberId: 'm_dad' });

    expect(memberActivity(state, 'm_mom')).toEqual({ itemsAdded: 1, purchases: 0 });
    expect(memberActivity(state, 'm_dad')).toEqual({ itemsAdded: 0, purchases: 1 });
  });

  it('adding more to an item keeps whoever added it first', async () => {
    let { state } = await say(initialHouseholdState, 'get tomatoes 1 kg', 'm_mom');
    ({ state } = await say(state, 'get tomatoes 1 kg', 'm_dad'));
    const tomatoes = state.listItems.filter((li) => li.productId === 'p_tomato' && li.status === 'pending');
    expect(tomatoes).toHaveLength(1);
    expect(tomatoes[0].addedByMemberId).toBe('m_mom');
  });

  it('without a member nothing is tagged (older callers unchanged)', async () => {
    const { state } = await say(initialHouseholdState, 'get tomatoes 1 kg');
    expect(state.listItems.every((li) => li.addedByMemberId === undefined)).toBe(true);
  });
});
