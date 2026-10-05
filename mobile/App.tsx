import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Newsreader_400Regular_Italic, Newsreader_500Medium } from '@expo-google-fonts/newsreader';
import {
  IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import { HouseholdProvider, useHousehold } from './src/state/HouseholdContext';
import { ProfileProvider, useProfile } from './src/state/ProfileContext';
import { UIProvider } from './src/components/UIProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { theme } from './src/theme';

function Gate() {
  const { hydrated } = useHousehold();
  const { profile, hydrated: profileHydrated } = useProfile();
  if (!hydrated || !profileHydrated) return <View style={{ flex: 1, backgroundColor: theme.colors.bg }} />;
  return profile.onboarded ? <RootNavigator /> : <OnboardingScreen />;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Newsreader_500Medium, Newsreader_400Regular_Italic,
    IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold,
  });

  return (
    <SafeAreaProvider style={{ backgroundColor: theme.colors.bg }}>
      <HouseholdProvider>
        <ProfileProvider>
          <UIProvider>
            {fontsLoaded ? <Gate /> : <View style={{ flex: 1, backgroundColor: theme.colors.bg }} />}
            <StatusBar style="dark" />
          </UIProvider>
        </ProfileProvider>
      </HouseholdProvider>
    </SafeAreaProvider>
  );
}
