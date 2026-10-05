import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import type { ListItem } from '../types';
import { ConfidenceDot } from '../components/ConfidenceDot';
import { Button, CloseButton, FieldRow, Kicker, Sheet } from '../components/hearth';

interface Props {
  item: ListItem | null;
  onClose: () => void;
  onSaved?: (msg: string) => void;
}

const SOURCE_LABEL: Record<ListItem['source'], string> = {
  user: 'You said it',
  household_memory: 'Household memory',
  purchase_history: 'Purchase history',
  guess: 'A guess',
};

/** Why an item is on the list — product, amount, confidence, source, and the plain-English rationale. */
export function ItemDetailModal({ item, onClose, onSaved }: Props) {
  const { removeItem, saveAsUsual } = useHousehold();
  if (!item) return null;
  const canSave = !!(item.qty && item.unit);

  return (
    <Sheet visible onClose={onClose} title={item.product} sub={item.category} right={<CloseButton onPress={onClose} />}>
      <FieldRow k="Quantity" v={item.qty != null ? `${item.qty} ${item.unit ?? ''}` : 'Not said yet'} />
      <FieldRow k="Brand" v={item.brand ?? '—'} />
      <FieldRow k="Variant" v={item.variant ?? '—'} />
      <FieldRow k="Confidence">
        <View style={styles.conf}>
          <ConfidenceDot level={item.confidence} size={8} />
          <Text style={styles.confText}>{item.confidence}</Text>
        </View>
      </FieldRow>
      <FieldRow k="Source" v={SOURCE_LABEL[item.source]} />

      <View style={styles.why}>
        <Kicker style={{ fontSize: 11, letterSpacing: 2 }}>Why this was added</Kicker>
        <Text style={styles.rationale}>{item.rationale}</Text>
      </View>

      <View style={{ gap: 10, marginTop: 22 }}>
        <Button
          label="Save as our usual"
          kind="ink"
          disabled={!canSave}
          onPress={() => {
            saveAsUsual({
              productId: item.productId,
              preferredBrand: item.brand ?? undefined,
              preferredVariant: item.variant ?? undefined,
              typicalQty: item.qty!,
              typicalUnit: item.unit!,
            });
            onClose();
            onSaved?.(`Saved ${item.product.toLowerCase()} as your usual`);
          }}
        />
        {item.status === 'pending' && (
          <Button label="Remove from list" kind="accentOutline" onPress={() => { removeItem(item.id); onClose(); }} />
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  conf: { flexDirection: 'row', alignItems: 'center' },
  confText: { fontFamily: theme.font.serif, fontSize: 18, color: theme.colors.ink, textTransform: 'capitalize' },
  why: { borderTopWidth: 1, borderTopColor: theme.colors.ink, paddingTop: 14, marginTop: 10 },
  rationale: { fontFamily: theme.font.serifItalic, fontSize: 19, lineHeight: 27, color: theme.colors.textSoft, marginTop: 8 },
});
