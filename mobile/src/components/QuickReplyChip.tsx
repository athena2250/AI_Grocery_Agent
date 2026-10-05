import React from 'react';
import { Chip } from './hearth';

export function QuickReplyChip({ label, onPress, suggested }: { label: string; onPress: () => void; suggested?: boolean }) {
  return <Chip label={label} onPress={onPress} suggested={suggested} quiet={label === 'Not now'} />;
}
