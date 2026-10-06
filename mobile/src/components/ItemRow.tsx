import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { theme } from '../theme';
import type { ListItem } from '../types';
import { CheckCircle } from './hearth';
import { ConfidenceDot } from './ConfidenceDot';
import { TrashIcon } from './icons';

interface Props {
  item: ListItem;
  onTogglePurchased: () => void;
  onPress: () => void;
  onDelete: () => void;
}

const SOURCE_LABEL: Record<ListItem['source'], string> = {
  user: 'you said',
  household_memory: 'your usual',
  purchase_history: 'from history',
  guess: 'a guess',
};

export function ItemRow({ item, onTogglePurchased, onPress, onDelete }: Props) {
  const purchased = item.status === 'purchased';
  const amount = [item.qty != null ? `${item.qty} ${item.unit ?? ''}`.trim() : 'how much?', item.brand].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Pressable onPress={onTogglePurchased} hitSlop={10} accessibilityLabel={purchased ? 'Bought' : 'Mark bought'}>
        <CheckCircle on={purchased} onColor={theme.colors.green} />
      </Pressable>
      <View style={styles.body}>
        <Text style={[styles.title, purchased && styles.done]}>{item.product}</Text>
        <View style={styles.metaRow}>
          <ConfidenceDot level={item.confidence} size={7} />
          <Text style={styles.meta}>{amount} · {SOURCE_LABEL[item.source]}</Text>
        </View>
      </View>
      <Pressable
        onPress={onDelete}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${item.product}`}
        style={({ pressed }) => [styles.delete, pressed && { opacity: 0.5 }]}
      >
        <TrashIcon size={16} color={theme.colors.textFaint} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 2, borderTopWidth: 1, borderTopColor: theme.colors.hairline,
  },
  body: { flex: 1 },
  title: { fontFamily: theme.font.serif, fontSize: 20, color: theme.colors.ink },
  done: { color: theme.colors.textFaint, textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  meta: { fontFamily: theme.font.sans, fontSize: 13, color: theme.colors.textFaint, flexShrink: 1 },
  delete: { padding: 4 },
});
