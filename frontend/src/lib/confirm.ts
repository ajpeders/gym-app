import { Alert, Platform } from 'react-native';

/** Yes/no prompt that works on web (no Alert.alert there) and native alike. */
export function confirm(
  title: string,
  message: string,
  onConfirm: () => void,
  destructive = false,
) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'OK', style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
