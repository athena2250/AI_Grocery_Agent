import { useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useHousehold } from './HouseholdContext';
import { useProfile } from './ProfileContext';
import { useUI } from '../components/UIProvider';
import { getAuthService } from '../services/serviceFactory';
import { theme } from '../theme';

/**
 * Sign out, delete my account — the same from More and from
 * your profile. Signed in to the server, signing out also forgets this phone's
 * copy of the family's lists (they are safe on the server); in the sandbox the
 * lists stay on the phone as before.
 */
export function useAccountActions() {
  const { account, token, signOut } = useAuth();
  const { reset } = useHousehold();
  const { shared, resetProfile, forgetMe } = useProfile();
  const { ask, flash } = useUI();

  const leave = useCallback(async () => {
    if (shared) { await reset(); await resetProfile(); }
    await signOut();
  }, [shared, reset, resetProfile, signOut]);

  const confirmSignOut = useCallback(() => ask({
    title: 'Sign out?',
    body: shared
      ? 'Your family’s lists stay safe. Sign in again with your name, number and passkey to see them.'
      : 'Your home’s lists and memory stay on this phone. Sign in again with your name, number and passkey.',
    options: [{ label: 'Sign out', kind: 'danger', onPress: leave }],
  }), [ask, shared, leave]);

  const confirmDelete = useCallback(() => {
    if (!account) return;
    ask({
      title: 'Delete your account?',
      body: shared
        ? 'This signs you out everywhere and removes your name and number. What you added stays with your family. If you are the last one in the home, its lists are deleted too. This can’t be undone.'
        : 'This removes your account from this phone and signs you out. This can’t be undone.',
      options: [{
        label: 'Delete my account',
        kind: 'danger',
        onPress: async () => {
          // Clear my row in the family's list first — after deletion this phone can't send.
          if (shared && !(await forgetMe())) {
            flash('No connection. Connect to the internet and try again.', theme.colors.red);
            return;
          }
          const r = await getAuthService().deleteAccount(account, token);
          if (!r.ok) { flash(r.message, theme.colors.red); return; }
          await reset();
          await resetProfile();
          await signOut();
        },
      }],
    });
  }, [account, token, shared, ask, flash, reset, resetProfile, signOut, forgetMe]);

  return { confirmSignOut, confirmDelete };
}
