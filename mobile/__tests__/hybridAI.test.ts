import { initialHouseholdState } from '../src/data/seed';
import { buildChatContext } from '../src/state/reducer';
import { HybridAIService, toCommands, type Extraction } from '../src/services/HybridAIService';

const ctx = () => buildChatContext(initialHouseholdState);
const ext = (e: Partial<Extraction>): Extraction => ({ intent: 'UNKNOWN', items: [], inventory_updates: [], purchases_marked: [], ...e });

describe('toCommands', () => {
  it('turns extractions into phrases the rules know', () => {
    expect(toCommands(ext({
      intent: 'UPDATE_INVENTORY',
      inventory_updates: [{ raw_text: 'biyyam aipovachindi', product_guess: 'rice', state: 'almost_finished' }],
    }))).toEqual([{ text: 'rice is almost finished', add: false }]);

    expect(toCommands(ext({
      intent: 'ADD_ITEMS',
      items: [
        { raw_text: 'do kilo tamatar', canonical_guess: 'tomatoes', qty: 2, unit: 'kilos' },
        { raw_text: 'dhaniya ke beej', canonical_guess: 'coriander', variant_hint: 'seeds' },
        { raw_text: 'the usual biscuits', canonical_guess: 'biscuits', variant_hint: 'usual' },
        { raw_text: 'harpic', qty: 3, unit: 'bottles' },
      ],
    })).map((c) => c.text)).toEqual(['get 2 kg tomatoes', 'get coriander seeds', 'get the usual biscuits', 'get harpic']);

    expect(toCommands(ext({ intent: 'MARK_PURCHASED', purchases_marked: ['tomatoes'] }))).toEqual([{ text: 'mark tomatoes purchased', add: false }]);
    expect(toCommands(ext({ intent: 'SHOW_LIST' }))).toEqual([{ text: 'show list', add: false }]);
    expect(toCommands(ext({ intent: 'CLARIFY_RESPONSE' }))).toEqual([]);
  });
});

describe('HybridAIService', () => {
  it('answers what the rules know without asking the server', async () => {
    const understand = jest.fn();
    const r = await new HybridAIService(understand).chat('rice is almost finished', ctx());
    expect(understand).not.toHaveBeenCalled();
    expect(r.inventoryUpdates[0]).toMatchObject({ productId: 'p_rice', state: 'almost_finished' });
  });

  it('asks the LLM only for what the rules miss, then answers through the rules', async () => {
    const understand = jest.fn().mockResolvedValue(ext({
      intent: 'UPDATE_INVENTORY',
      inventory_updates: [{ raw_text: 'the white grain thing is nearly done', product_guess: 'rice', state: 'almost_finished' }],
    }));
    const r = await new HybridAIService(understand).chat('the white grain thing is nearly done', ctx());
    expect(understand).toHaveBeenCalledWith('the white grain thing is nearly done');
    expect(r.intent).toBe('UPDATE_INVENTORY');
    expect(r.inventoryUpdates[0]).toMatchObject({ productId: 'p_rice', state: 'almost_finished' });
    expect(r.clarifications[0]?.kind).toBe('restock'); // the rules still ask before adding
  });

  it('several items in one message become one reply', async () => {
    const understand = jest.fn().mockResolvedValue(ext({
      intent: 'ADD_ITEMS',
      items: [{ raw_text: 'tamatar', canonical_guess: 'tomatoes', qty: 1, unit: 'kg' }, { raw_text: 'dahi', canonical_guess: 'curd', qty: 1, unit: 'pack' }],
    }));
    const r = await new HybridAIService(understand).chat('ek kilo tamatar aur dahi ka packet', ctx());
    expect(r.proposedItems.map((p) => p.productId).sort()).toEqual(['p_curd', 'p_tomato']);
    expect(r.reply.split('\n')).toHaveLength(2);
  });

  it('falls back to the rules when the server is unreachable', async () => {
    const understand = jest.fn().mockRejectedValue(new Error('offline'));
    const r = await new HybridAIService(understand).chat('blah blah', ctx());
    expect(r.reply).toMatch(/didn't catch that/);
  });
});
