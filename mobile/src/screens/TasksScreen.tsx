import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { EmptyState } from '../components/hearth';
import { CheckIcon } from '../components/icons';

/** Placeholder chapter: tasks, bills and repairs arrive with the family feed (backend `feed/`). */
export function TasksScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <EmptyState
        icon={<CheckIcon size={40} color="#C0B6A3" strokeWidth={1.3} />}
        title="Family tasks, tidy"
        body="Repairs, bookings and errands — grouped by who's doing them — will gather here with the family feed."
      />
    </SafeAreaView>
  );
}
