import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Newsreader_400Regular_Italic, Newsreader_500Medium } from '@expo-google-fonts/newsreader';
import {
  IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import { HouseholdProvider, useHousehold } from './src/state/HouseholdContext';
import { ProfileProvider, useProfile } from './src/state/ProfileContext';
import { TasksProvider, useTasks } from './src/state/TasksContext';
import { AuthProvider, useAuth } from './src/state/AuthContext';
import { UIProvider } from './src/components/UIProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { theme } from './src/theme';

/** Signed out → sign in / sign up; signed in but not set up → onboarding; else the home. */
function Gate() {
  const { hydrated } = useHousehold();
  const { profile, hydrated: profileHydrated, linkAccount } = useProfile();
  const { hydrated: tasksHydrated } = useTasks();
  const { account, hydrated: authHydrated } = useAuth();
  const ready = hydrated && profileHydrated && tasksHydrated && authHydrated;

  // Re-runs after "Reset everything" (onboarded flips back) so setup starts with you in it.
  useEffect(() => {
    if (ready && account) linkAccount(account);
  }, [ready, account, profile.onboarded, linkAccount]);

  if (!authHydrated) return <View style={{ flex: 1, backgroundColor: theme.colors.bg }} />;
  if (!account) return <AuthScreen />;
  if (!ready) {
    // Signed in to the server: the first catch-up with the family's lists.
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: theme.font.serif, fontSize: 20, color: theme.colors.textSoft }}>Getting your home ready…</Text>
      </View>
    );
  }
  return profile.onboarded ? <RootNavigator /> : <OnboardingScreen />;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Newsreader_500Medium, Newsreader_400Regular_Italic,
    IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold,
  });

  return (
    <SafeAreaProvider style={{ backgroundColor: theme.colors.bg }}>
      <AuthProvider>
        <ProfileProvider>
          <HouseholdProvider>
            <TasksProvider>
              <UIProvider>
                {fontsLoaded ? <Gate /> : <View style={{ flex: 1, backgroundColor: theme.colors.bg }} />}
                <StatusBar style="dark" />
              </UIProvider>
            </TasksProvider>
          </HouseholdProvider>
        </ProfileProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
