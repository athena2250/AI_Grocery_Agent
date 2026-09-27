import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { theme } from '../theme';
import { ChatScreen } from '../screens/ChatScreen';
import { ListScreen } from '../screens/ListScreen';
import { PantryScreen } from '../screens/PantryScreen';
import { MemoryScreen } from '../screens/MemoryScreen';
import { HistoryScreen } from '../screens/HistoryScreen';

const Tab = createBottomTabNavigator();

const icons: Record<string, string> = {
  Chat: '💬',
  List: '🛒',
  Pantry: '🥫',
  Memory: '🧠',
  History: '📜',
};

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.textMuted,
          tabBarStyle: { backgroundColor: theme.colors.surface },
          tabBarIcon: ({ focused }) => (
            <Text style={[styles.icon, focused && styles.iconActive]}>{icons[route.name] ?? '•'}</Text>
          ),
        })}
      >
        <Tab.Screen name="Chat" component={ChatScreen} />
        <Tab.Screen name="List" component={ListScreen} />
        <Tab.Screen name="Pantry" component={PantryScreen} />
        <Tab.Screen name="Memory" component={MemoryScreen} />
        <Tab.Screen name="History" component={HistoryScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 18 },
  iconActive: { fontSize: 20 },
});
