import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '../theme';
import type { Confidence } from '../types';

export function ConfidenceDot({ level, size = 10 }: { level: Confidence; size?: number }) {
  const color = level === 'high' ? theme.colors.high : level === 'medium' ? theme.colors.medium : theme.colors.low;
  return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  dot: { marginRight: 7 },
});
