import { ImageOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, View, type ImageStyle, type StyleProp } from 'react-native';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { tokenStore } from '@/lib/storage';

/**
 * Image behind the authenticated proxy (`/api/submissions/:id/image`): the bearer token is sent
 * as a header. If the token expired, one cheap authenticated call triggers the refresh and the
 * image is requested again.
 */
export function AuthImage({ submissionId, style, contain }: { submissionId: string; style?: StyleProp<ImageStyle>; contain?: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tokenStore.load().then((t) => !cancelled && setToken(t?.accessToken ?? null));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (failed || !token) {
    return (
      <View style={style as StyleProp<never>} className="items-center justify-center bg-slate-200 dark:bg-[#1f2744]">
        {failed && <ImageOff size={22} color="#94a3b8" />}
      </View>
    );
  }
  return (
    <Image
      source={{ uri: `${API_URL}/api/submissions/${submissionId}/image`, headers: { Authorization: `Bearer ${token}` } }}
      style={style}
      resizeMode={contain ? 'contain' : 'cover'}
      onError={() => {
        if (attempt === 0) {
          // First failure: refresh the token via a normal API call, then retry once.
          api.request('/api/me').then(() => setAttempt(1)).catch(() => setFailed(true));
        } else setFailed(true);
      }}
    />
  );
}
