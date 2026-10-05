import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme';
import { Masthead } from './hearth';

/** Frame for screens pushed from More: "‹ Back" link above a masthead. */
export function SubScreen({ kicker, title, sub, right, children }: {
  kicker: string; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  const navigation = useNavigation();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
          <Text style={styles.backText}>‹  Back</Text>
        </Pressable>
        <Masthead kicker={kicker} title={title} sub={sub} right={right} />
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  head: { paddingHorizontal: theme.gutter },
  back: { paddingTop: 8, paddingBottom: 2, alignSelf: 'flex-start' },
  backText: { fontFamily: theme.font.sansBold, fontSize: 14, color: theme.colors.accent },
});
