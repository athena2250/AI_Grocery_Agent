import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useHousehold } from '../state/HouseholdContext';
import { useProfile } from '../state/ProfileContext';
import { useAuth } from '../state/AuthContext';
import { useTasks } from '../state/TasksContext';
import { formatPhone } from '../state/phone';
import { getAuthService } from '../services/serviceFactory';
import { useUI } from '../components/UIProvider';
import { Masthead, SectionHeading } from '../components/hearth';

const c = theme.colors;
const f = theme.font;

/** Everything else: the conversation log, pantry, memory, history, sign out, and sandbox reset. */
export function MoreScreen({ navigation }: { navigation: any }) {
  const { state, reset } = useHousehold();
  const { me, ownerId, resetProfile } = useProfile();
  const { archive, taskPrefs } = useTasks();
  const { account, signOut } = useAuth();
  const { ask } = useUI();

  const low = state.inventory.filter((i) => i.state !== 'available').length;
  const rows = [
    { route: 'Profile', title: 'Your profile', desc: `${me.name} · ${me.relation}` },
    { route: 'Conversation', title: 'Conversation', desc: `${state.turns.length} messages with Hearth` },
    { route: 'Pantry', title: 'Pantry', desc: low ? `${low} running low or out` : 'What the home keeps in stock' },
    { route: 'Memory', title: 'Household memory', desc: `${state.preferences.length + state.aliasPreferences.length + taskPrefs.length} things learned` },
    { route: 'History', title: 'Purchase history', desc: `${state.history.length} purchases` },
    // Admin only: tasks that have left the board.
    ...(me.id === ownerId ? [{ route: 'TaskHistory', title: 'Task history', desc: `${archive.length} past tasks · admin only` }] : []),
  ];

  const confirmSignOut = () => ask({
    title: 'Sign out?',
    body: 'Your home’s lists and memory stay on this phone. Sign in again with your name, number and a code.',
    options: [{ label: 'Sign out', kind: 'danger', onPress: signOut }],
  });

  const confirmReset = () => ask({
    title: 'Start over?',
    body: 'Clears the list, pantry, memory and conversation, reloads the sample data, forgets the accounts on this phone, and signs you out.',
    options: [{
      label: 'Reset everything',
      kind: 'danger',
      onPress: async () => { await reset(); await resetProfile(); await getAuthService().forgetAll(); await signOut(); },
    }],
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page}>
        <Masthead kicker="Chapter" title="Everything else" />
        <View style={{ marginTop: 10 }}>
          {rows.map((r) => (
            <Pressable key={r.route} onPress={() => navigation.navigate(r.route)} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{r.title}</Text>
                <Text style={styles.desc}>{r.desc}</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))}
        </View>

        <SectionHeading title="Account" />
        <Pressable onPress={confirmSignOut} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: c.accent }]}>Sign out</Text>
            <Text style={styles.desc}>{account ? `Signed in as ${account.name} · ${formatPhone(account.phone)}` : 'Not signed in'}</Text>
          </View>
        </Pressable>

        <SectionHeading title="Coming soon" />
        <Text style={styles.soon}>Bills, repairs and plans — shared with the whole family as posts — arrive with the family feed.</Text>

        <SectionHeading title="Sandbox" />
        <Pressable onPress={confirmReset} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: c.accent }]}>Reset everything</Text>
            <Text style={styles.desc}>Back to the sample household, signed out</Text>
          </View>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  page: { paddingTop: 8, paddingHorizontal: theme.gutter, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderTopWidth: 1, borderTopColor: c.hairline },
  title: { fontFamily: f.serif, fontSize: 22, color: c.ink },
  desc: { fontFamily: f.sans, fontSize: 13, color: c.textFaint, marginTop: 2 },
  chev: { fontSize: 22, color: c.checkOff },
  soon: { fontFamily: f.serifItalic, fontSize: 17, lineHeight: 24, color: c.textSoft, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.hairline },
});
