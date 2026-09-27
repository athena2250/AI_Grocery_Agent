import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import type { ListItem } from '../types';
import { ConfidenceDot } from '../components/ConfidenceDot';

interface Props {
  item: ListItem | null;
  onClose: () => void;
}

export function ItemDetailModal({ item, onClose }: Props) {
  const { removeItem, saveAsUsual } = useHousehold();
  if (!item) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <ScrollView>
          <Text style={styles.title}>{item.product}</Text>
          <Text style={styles.cat}>{item.category}</Text>

          <Row label="Quantity" value={`${item.qty ?? '?'} ${item.unit ?? ''}`} />
          <Row label="Brand" value={item.brand ?? '—'} />
          <Row label="Variant" value={item.variant ?? '—'} />
          <View style={styles.row}>
            <Text style={styles.label}>Confidence</Text>
            <View style={styles.conf}>
              <ConfidenceDot level={item.confidence} />
              <Text style={styles.value}>{item.confidence}</Text>
            </View>
          </View>
          <Row label="Source" value={item.source.replace('_', ' ')} />

          <Text style={styles.rationaleLabel}>Why this was added</Text>
          <Text style={styles.rationale}>{item.rationale}</Text>

          <View style={styles.actions}>
            <Pressable
              style={styles.actionBtn}
              onPress={() => {
                if (item.qty && item.unit) {
                  saveAsUsual({
                    productId: item.productId,
                    preferredBrand: item.brand ?? undefined,
                    preferredVariant: item.variant ?? undefined,
                    typicalQty: item.qty,
                    typicalUnit: item.unit,
                  });
                  onClose();
                }
              }}
            >
              <Text style={styles.actionText}>Save as usual</Text>
            </Pressable>
            {item.status === 'pending' && (
              <Pressable style={[styles.actionBtn, styles.dangerBtn]} onPress={() => { removeItem(item.id); onClose(); }}>
                <Text style={[styles.actionText, styles.dangerText]}>Remove item</Text>
              </Pressable>
            )}
          </View>

          <Pressable style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '85%',
    backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20,
  },
  title: { fontSize: theme.font.large, fontWeight: '700', color: theme.colors.text },
  cat: { color: theme.colors.textMuted, marginBottom: 14 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8,
    borderBottomWidth: 1, borderColor: theme.colors.border,
  },
  label: { color: theme.colors.textMuted, fontSize: theme.font.body },
  value: { color: theme.colors.text, fontSize: theme.font.body, fontWeight: '600' },
  conf: { flexDirection: 'row', alignItems: 'center' },
  rationaleLabel: { marginTop: 14, color: theme.colors.textMuted, fontSize: theme.font.small, textTransform: 'uppercase', letterSpacing: 1 },
  rationale: { color: theme.colors.text, marginTop: 4, fontSize: theme.font.body, lineHeight: 20 },
  actions: { marginTop: 20 },
  actionBtn: {
    borderWidth: 1, borderColor: theme.colors.primary, paddingVertical: 12, borderRadius: theme.radius.md,
    alignItems: 'center', marginBottom: 8,
  },
  actionText: { color: theme.colors.primary, fontWeight: '700' },
  dangerBtn: { borderColor: theme.colors.danger },
  dangerText: { color: theme.colors.danger },
  close: { alignItems: 'center', paddingVertical: 12, marginTop: 8 },
  closeText: { color: theme.colors.textMuted },
});
