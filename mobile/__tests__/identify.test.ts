import { reducer } from '../src/state/reducer';
import { visibleItems } from '../src/state/planner';
import { amountChoices, identifyItem, newCatalogProduct, unitChoices } from '../src/state/identify';
import { initialHouseholdState } from '../src/data/seed';

const s = initialHouseholdState;
const ids = (text: string) => identifyItem(text, s)?.candidates.map((p) => p.id);

describe('identifyItem — Add item, step 1', () => {
  it('reads a brand as its product, keeps the brand, and leaves the kind open', () => {
    const m = identifyItem('Surf Excel', s)!;
    expect(m.brand).toBe('Surf Excel');
    expect(m.candidates.map((p) => p.category)).toEqual(['Detergents', 'Detergents', 'Detergents']);
    expect(m.group).toBe('detergent');
  });

  it('narrows the kind when she says it', () => {
    expect(ids('surf excel liquid')).toEqual(['p_detergent_liquid']);
  });

  it('finds fruit by name, singular or plural, and pulls out a typed amount', () => {
    expect(ids('apple')).toEqual(['p_apple']);
    expect(ids('Apples')).toEqual(['p_apple']);
    expect(identifyItem('apples 2 kg', s)!.qty).toEqual({ qty: 2, unit: 'kg' });
  });

  it('matches while she is still typing', () => {
    expect(ids('tomat')).toEqual(['p_tomato']);
  });

  it('an unknown item has no candidates, only a section guess', () => {
    const m = identifyItem('kiwi', s)!;
    expect(m.candidates).toEqual([]);
    expect(m.guess).toBe('Fruits');
    expect(identifyItem('quinoa', s)!.guess).toBe('Rice & Grains');
  });

  it('offers amounts in the product unit', () => {
    expect(unitChoices('kg')).toEqual(['kg', 'g']);
    expect(amountChoices('kg')).toContain(1);
  });
});

describe('ADD_ITEM — Add item, step 2', () => {
  it('adds a catalog item with her details and learns her pick of kind', () => {
    const powder = s.products.find((p) => p.id === 'p_detergent_powder')!;
    const next = reducer(s, {
      type: 'ADD_ITEM',
      item: { product: powder, qty: 2, unit: 'kg', brand: 'Surf Excel', variant: 'front load', chosenFromGroup: 'detergent' },
    });
    const [li] = visibleItems(next.listItems);
    expect(li).toMatchObject({ product: 'Detergent powder', category: 'Detergents', qty: 2, unit: 'kg', brand: 'Surf Excel', variant: 'front load', source: 'user' });
    expect(next.aliasPreferences.find((a) => a.disambiguationGroup === 'detergent')?.productId).toBe('p_detergent_powder');
  });

  it('files a new item in the section she tapped', () => {
    const quinoa = newCatalogProduct('quinoa', 'Rice & Grains', 'g');
    const next = reducer(s, { type: 'ADD_ITEM', item: { product: quinoa, qty: 500, unit: 'g', brand: null, variant: null } });
    expect(next.products.find((p) => p.id === quinoa.id)?.category).toBe('Rice & Grains');
    expect(identifyItem('quinoa', next)!.candidates.map((p) => p.name)).toEqual(['Quinoa']);
    expect(visibleItems(next.listItems)[0].category).toBe('Rice & Grains');
  });
});
