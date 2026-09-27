import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { theme } from '../theme';
import type { ListItem } from '../types';
import { ConfidenceDot } from './ConfidenceDot';

interface Props {
  item: ListItem;
  onTogglePurchased: () => void;
  onPress: () => void;
}

export function ItemRow({ item, onTogglePurchased, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Pressable onPress={onTogglePurchased} hitSlop={10} style={[styles.check, item.purchased && styles.checked]}>
        {item.purchased && <Text style={styles.checkMark}>✓</Text>}
      </Pressable>
      <View style={styles.body}>
        <Text style={[styles.title, item.purchased && styles.strike]}>
          {item.product}
          {item.brand ? ` · ${item.brand}` : ''}
        </Text>
        <View style={styles.metaRow}>
          <ConfidenceDot level={item.confidence} />
          <Text style={styles.meta}>
            {item.qty ?? '?'} {item.unit ?? ''} · {item.source.replace('_', ' ')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  check: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: theme.colors.primary,
    marginRight: 12, alignItems: 'center', justifyContent: 'center',
  },
  checked: { backgroundColor: theme.colors.primary },
  checkMark: { color: 'white', fontWeight: '900', fontSize: 14, lineHeight: 14 },
  body: { flex: 1 },
  title: { fontSize: theme.font.body, color: theme.colors.text, fontWeight: '600' },
  strike: { textDecorationLine: 'line-through', color: theme.colors.textMuted },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  meta: { fontSize: theme.font.small, color: theme.colors.textMuted },
});
