import { useColorScheme } from 'react-native';

/** Raw colors for places where class names cannot be used (icons, navigation chrome). */
export function useThemeColors() {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    background: dark ? '#0b1020' : '#f8fafc',
    surface: dark ? '#141a2e' : '#ffffff',
    text: dark ? '#f1f5f9' : '#0f172a',
    muted: dark ? '#94a3b8' : '#64748b',
    border: dark ? '#26304d' : '#e2e8f0',
    brand: '#4f46e5',
    brandSoft: dark ? '#818cf8' : '#4f46e5',
    danger: dark ? '#f87171' : '#dc2626',
    success: dark ? '#4ade80' : '#16a34a',
  };
}
