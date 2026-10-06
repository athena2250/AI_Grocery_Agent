import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { useUI } from '../components/UIProvider';
import { CartIcon, CheckIcon, HomeIcon, MenuIcon, PlusIcon } from '../components/icons';
import { HomeScreen } from '../screens/HomeScreen';
import { TasksScreen } from '../screens/TasksScreen';
import { ListScreen } from '../screens/ListScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { PantryScreen } from '../screens/PantryScreen';
import { MemoryScreen } from '../screens/MemoryScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { TaskHistoryScreen } from '../screens/TaskHistoryScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const c = theme.colors;

const ICONS: Record<string, (color: string) => React.ReactNode> = {
  Home: (color) => <HomeIcon color={color} />,
  Tasks: (color) => <CheckIcon color={color} />,
  Groceries: (color) => <CartIcon color={color} />,
  More: (color) => <MenuIcon color={color} />,
};

/** Hearth.html's bottom bar: Home · Tasks · (+) · Groceries · More, with the raised terracotta + in the middle. */
function HearthTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { openAdd } = useUI();

  const tab = (route: (typeof state.routes)[number], index: number) => {
    const focused = state.index === index;
    const color = focused ? c.accent : c.kicker;
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
    };
    return (
      <Pressable key={route.key} onPress={onPress} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: focused }}>
        {ICONS[route.name]?.(color)}
        <Text style={[styles.label, { color }]}>{route.name}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      <View style={styles.bar}>
        {state.routes.slice(0, 2).map((r, i) => tab(r, i))}
        <View style={styles.fabGap} />
        {state.routes.slice(2).map((r, i) => tab(r, i + 2))}
      </View>
      <Pressable
        onPress={openAdd}
        style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.96 }] }]}
        accessibilityLabel="Add something"
      >
        <PlusIcon color={c.onDark} />
      </Pressable>
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <HearthTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Tasks" component={TasksScreen} />
      <Tab.Screen name="Groceries" component={ListScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}

const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: c.bg, primary: c.accent, text: c.ink, card: c.bg } };

export function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="Conversation" component={ChatScreen} />
        <Stack.Screen name="Pantry" component={PantryScreen} />
        <Stack.Screen name="Memory" component={MemoryScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="TaskHistory" component={TaskHistoryScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: c.bg },
  bar: { height: 60, flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: '#E0D8C8', backgroundColor: c.bg },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { fontFamily: theme.font.sansBold, fontSize: 10, letterSpacing: 0.5 },
  fabGap: { width: 74 },
  fab: {
    position: 'absolute', alignSelf: 'center', top: -22, width: 62, height: 62, borderRadius: 31,
    backgroundColor: c.accent, borderWidth: 4, borderColor: c.bg, alignItems: 'center', justifyContent: 'center',
    shadowColor: c.accent, shadowOpacity: 0.32, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
});
