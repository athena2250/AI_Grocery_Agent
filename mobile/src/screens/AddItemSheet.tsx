import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { CATEGORY_ORDER } from '../state/planner';
import { amountChoices, fmtQty, identifyItem, newCatalogProduct, unitChoices } from '../state/identify';
import { Button, Chip, CloseButton, Dot, FieldRow, Kicker, Sheet } from '../components/hearth';
import { useUI } from '../components/UIProvider';
import type { Category, Product } from '../types';

const c = theme.colors;
const SECTIONS = CATEGORY_ORDER.filter((s) => s !== 'Other');

/**
 * "Add item" — two pages. 1: she types the item and Hearth works out what it is
 * from the catalog ("surf excel" → Detergents). 2: the details that item needs —
 * which kind, how much in its unit, brand, anything else. Chips from memory or a
 * keyword guess are only marked; nothing is chosen for her, and Add stays off
 * until the kind (or section) and amount are picked.
 */
export function AddItemSheet({ seed, onClose }: { seed: string; onClose: () => void }) {
  const { state, addItem } = useHousehold();
  const { flash, openCompose } = useUI();
  const [step, setStep] = useState<'name' | 'details'>('name');
  const [text, setText] = useState(seed);

  const match = useMemo(() => identifyItem(text, state), [text, state]);

  // Details page
  const [product, setProduct] = useState<Product | null>(null);
  const [section, setSection] = useState<Category | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [unit, setUnit] = useState('pcs');
  const [custom, setCustom] = useState('');
  const [brand, setBrand] = useState('');
  const [notes, setNotes] = useState('');

  const usual = product ? state.preferences.find((p) => p.productId === product.id) : undefined;
  const usualQty = usual?.typicalQty != null && usual.typicalUnit ? { qty: usual.typicalQty, unit: usual.typicalUnit } : null;

  const pickProduct = (p: Product) => {
    setProduct(p);
    const pref = state.preferences.find((x) => x.productId === p.id);
    // Her typed amount wins; otherwise start in the product's own unit (memory's unit if it has one).
    setUnit(match?.qty?.unit ?? pref?.typicalUnit ?? p.defaultUnit);
  };

  const next = () => {
    if (!match) return;
    setStep('details');
    setBrand(match.brand ?? '');
    setQty(match.qty?.qty ?? null);
    if (match.qty) setUnit(match.qty.unit);
    if (match.candidates.length === 1) pickProduct(match.candidates[0]);
    else { setProduct(null); if (!match.qty) setUnit('pcs'); }
  };

  const isNew = !!match && match.candidates.length === 0;
  const category = isNew ? section : product?.category ?? null;
  const missing = [
    !isNew && !product && 'which kind',
    isNew && !section && 'section',
    qty == null && 'how much',
  ].filter(Boolean) as string[];

  const save = () => {
    if (!match || qty == null || missing.length) return;
    const p = isNew ? newCatalogProduct(match.name, section!, unit) : product!;
    addItem({
      product: p,
      qty,
      unit,
      brand: brand.trim() || null,
      variant: notes.trim() || null,
      ...(match.candidates.length > 1 && match.group ? { chosenFromGroup: match.group } : {}),
      usedUsualQty: !!usualQty && usualQty.qty === qty && usualQty.unit === unit,
    });
    onClose();
    flash(`Added ${p.name} · ${fmtQty(qty, unit)}`);
  };

  const units = unitChoices(product?.defaultUnit ?? (isNew ? unit : 'pcs'));
  const allUnits = isNew ? ['kg', 'g', 'L', 'ml', 'pcs', 'pack', 'dozen', 'bunch'] : units;
  const amounts = amountChoices(unit);
  const showUsual = usualQty && usualQty.unit === unit && !amounts.includes(usualQty.qty);

  const setCustomQty = (v: string) => {
    setCustom(v);
    const n = Number(v.replace(',', '.'));
    setQty(v.trim() && n > 0 ? n : null);
  };

  // ── Page 1: what is it? ──
  if (step === 'name') {
    const preview = !match ? null
      : match.candidates.length === 1 ? `${match.candidates[0].category} › ${match.brand ?? match.candidates[0].name}`
        : match.candidates.length > 1 ? `${match.candidates[0].category} › ${match.brand ?? match.name} — ${match.candidates.length} kinds`
          : `New item${match.guess ? ` — maybe ${match.guess}` : ''}`;
    return (
      <Sheet
        visible
        onClose={onClose}
        title="Add item"
        right={<CloseButton onPress={onClose} />}
        footer={<Button kind="accent" label="Next ›" onPress={next} disabled={!match} />}
      >
        <TextInput
          style={styles.big}
          value={text}
          onChangeText={setText}
          autoFocus
          placeholder="e.g. Surf Excel, apples"
          placeholderTextColor={c.textFaint}
          onSubmitEditing={next}
          returnKeyType="next"
        />
        {preview ? (
          <View style={styles.preview}>
            <Dot color={match!.candidates.length ? c.green : c.amber} />
            <Text style={styles.previewText}>{preview}</Text>
          </View>
        ) : null}
        <Pressable onPress={() => openCompose(text)} style={styles.freeform}>
          <Text style={styles.freeformText}>Several things at once? Type or speak it ›</Text>
        </Pressable>
      </Sheet>
    );
  }

  // ── Page 2: the details this item needs ──
  const title = match?.brand ?? product?.name ?? (match ? match.name.replace(/\b\w/g, (x) => x.toUpperCase()) : '');
  return (
    <Sheet
      visible
      onClose={onClose}
      tall
      title={title}
      sub={category ? `${category}${product && match?.brand ? ` › ${product.name}` : ''}` : 'Where does it go?'}
      right={<CloseButton onPress={onClose} />}
      footer={
        <Button
          kind="accent"
          label={missing.length ? `Still need: ${missing.join(', ')}` : `Add ${fmtQty(qty!, unit)}`}
          onPress={save}
          disabled={missing.length > 0}
        />
      }
    >
      {match && match.candidates.length > 1 && (
        <>
          <Kicker style={styles.kicker}>Which kind?</Kicker>
          <View style={styles.chips}>
            {match.candidates.map((p) => (
              <Chip
                key={p.id}
                label={product?.id === p.id ? `✓ ${p.name}` : p.name}
                suggested={product ? product.id === p.id : match.usualProductId === p.id}
                onPress={() => { pickProduct(p); setQty(null); setCustom(''); }}
              />
            ))}
          </View>
        </>
      )}

      {isNew && (
        <>
          <Kicker style={styles.kicker}>Which section?</Kicker>
          <View style={styles.chips}>
            {SECTIONS.map((s) => (
              <Chip
                key={s}
                label={section === s ? `✓ ${s}` : s}
                suggested={section ? section === s : match?.guess === s}
                onPress={() => setSection(s)}
              />
            ))}
          </View>
        </>
      )}

      {(product || isNew) && (
        <>
          <Kicker style={styles.kicker}>How much?</Kicker>
          {allUnits.length > 1 && (
            <View style={styles.chips}>
              {allUnits.map((u) => (
                <Chip key={u} label={u} quiet={u !== unit} suggested={u === unit} onPress={() => { setUnit(u); setQty(null); setCustom(''); }} />
              ))}
            </View>
          )}
          <View style={styles.chips}>
            {amounts.map((n) => (
              <Chip
                key={n}
                label={qty === n && !custom ? `✓ ${fmtQty(n, unit)}` : fmtQty(n, unit)}
                suggested={qty === n && !custom ? true : !qty && usualQty?.qty === n && usualQty.unit === unit}
                onPress={() => { setQty(n); setCustom(''); }}
              />
            ))}
            {showUsual && (
              <Chip
                label={`Usual ${fmtQty(usualQty!.qty, unit)}`}
                suggested
                onPress={() => { setQty(usualQty!.qty); setCustom(''); }}
              />
            )}
          </View>
          {usualQty && <Text style={styles.hint}>You usually get {fmtQty(usualQty.qty, usualQty.unit)}.</Text>}
          <TextInput
            style={styles.input}
            value={custom}
            onChangeText={setCustomQty}
            keyboardType="decimal-pad"
            placeholder={`Other amount in ${unit}`}
            placeholderTextColor={c.textFaint}
          />

          <Kicker style={styles.kicker}>Brand</Kicker>
          <TextInput
            style={styles.input}
            value={brand}
            onChangeText={setBrand}
            placeholder="Any brand is fine"
            placeholderTextColor={c.textFaint}
          />
          {usual?.preferredBrand && brand !== usual.preferredBrand && (
            <View style={styles.chips}>
              <Chip label={`Usual: ${usual.preferredBrand}`} suggested onPress={() => setBrand(usual.preferredBrand!)} />
            </View>
          )}

          <Kicker style={styles.kicker}>Anything else?</Kicker>
          <TextInput
            style={[styles.input, styles.multi]}
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="e.g. front-load, ripe ones, small pack"
            placeholderTextColor={c.textFaint}
          />
        </>
      )}

      {category && qty != null && (
        <View style={{ marginTop: 18 }}>
          <FieldRow k="Goes under" v={category} />
        </View>
      )}

      <Button label="← Change item" kind="quiet" onPress={() => setStep('name')} style={{ marginTop: 10, paddingVertical: 12 }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  big: {
    borderWidth: 1, borderColor: c.border, borderRadius: 14, backgroundColor: c.paper,
    paddingHorizontal: 16, paddingVertical: 14, fontFamily: theme.font.serif, fontSize: 22, color: c.ink,
  },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 16 },
  previewText: { fontFamily: theme.font.sansMedium, fontSize: 15, color: c.textSoft, flex: 1 },
  kicker: { fontSize: 11, letterSpacing: 2, marginTop: 20, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  hint: { fontFamily: theme.font.serifItalic, fontSize: 15, color: c.textSoft, marginTop: 4, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: 12, backgroundColor: c.paper, marginTop: 6,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: theme.font.serif, fontSize: 17, color: c.ink,
  },
  multi: { minHeight: 64, textAlignVertical: 'top' },
  freeform: { paddingVertical: 16, marginTop: 14 },
  freeformText: { fontFamily: theme.font.serifItalic, fontSize: 16, color: c.textSoft, textAlign: 'center' },
});
