import { Platform, View } from 'react-native';

/**
 * Wraps credential fields in a real `<form>` on web, a plain `View` on native.
 *
 * Browsers only reliably offer to save and autofill a password when the field
 * sits inside a form — Chrome says so out loud ("Password field is not
 * contained in a form"). React Native has no form primitive, but react-native-web
 * renders to the DOM, so on web we can emit the element directly.
 *
 * It also gets Enter-to-submit for free, which a bare View never had.
 */
export function AuthForm({
  onSubmit,
  className,
  children,
}: {
  onSubmit: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (Platform.OS !== 'web') {
    return <View className={className}>{children}</View>;
  }
  return (
    <form
      // Never let the browser navigate — submission is ours to handle.
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {children}
    </form>
  );
}
