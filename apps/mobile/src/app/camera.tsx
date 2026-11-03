import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { CircleCheck, RefreshCcw, SwitchCamera, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, ErrorBanner, Swatch, Title } from '@/components/ui';
import { useI18n } from '@/i18n';
import { base64ToBytes } from '@/lib/base64';
import { blockThreshold, precheckFromJpeg } from '@/lib/color-precheck';
import type { GroupDetail } from '@/lib/types';
import { enqueuePhoto } from '@/lib/upload-queue';
import { useApi } from '@/lib/use-api';

const MAX_EDGE = 1080;

/**
 * Shrinks a photo to a tiny JPEG and evaluates it against the target colour (UX only).
 * Only done after a real capture: grabbing frames while previewing makes Android flash the screen.
 */
async function measure(uri: string, targetHex: string) {
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  context.resize({ width: 48 });
  const ref = await context.renderAsync();
  const small = await ref.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.7, base64: true });
  return small.base64 ? precheckFromJpeg(base64ToBytes(small.base64), targetHex) : null;
}

export default function CameraScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { t, tError } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const group = useApi<GroupDetail>(`/api/groups/${groupId}`);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [phase, setPhase] = useState<'live' | 'processing' | 'tooFar' | 'queued'>('live');
  const [error, setError] = useState<string | null>(null);

  const assignment = group.data?.latestAssignment ?? null;
  const threshold = group.data?.settings.acceptanceThreshold ?? 55;
  const usable = !!assignment?.isOpen && !group.data?.isArchived;

  const capture = useCallback(async () => {
    if (!camera.current || !assignment || phase !== 'live') return;
    setPhase('processing');
    setError(null);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.9, exif: false });
      // Resize to 1080 px on the long edge and re-encode: this also drops EXIF/GPS metadata.
      const context = ImageManipulator.ImageManipulator.manipulate(shot.uri);
      context.resize(shot.width >= shot.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
      const rendered = await context.renderAsync();
      const processed = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.8 });
      const result = await measure(processed.uri, assignment.colorHex);
      if (result && result.closeness < blockThreshold(threshold)) {
        setPhase('tooFar'); // the user retakes; the server stays the authority for borderline photos
        return;
      }
      await enqueuePhoto({
        groupId: groupId as string,
        assignmentId: assignment.id,
        deadlineAt: new Date(assignment.deadlineAt).getTime(),
        sourceUri: processed.uri,
        capturedAt: new Date().toISOString(),
        clientScore: result?.closeness ?? null,
      });
      setPhase('queued');
      setTimeout(() => router.back(), 1100);
    } catch {
      setError(t('camera.error'));
      setPhase('live');
    }
  }, [assignment, groupId, phase, router, t, threshold]);

  if (!permission) return <View className="flex-1 bg-black" />;

  if (!permission.granted) {
    return (
      <View className="flex-1 justify-center gap-4 bg-slate-50 p-6 dark:bg-[#0b1020]">
        <Title>{t('camera.permissionTitle')}</Title>
        <Body muted>{t('camera.permissionBody')}</Body>
        <Button label={t('camera.grant')} onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())} />
        <Button label={t('common.close')} variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView ref={camera} style={{ flex: 1 }} facing={facing} active={focused && phase !== 'queued'} />

      {/* Crosshair: the colour is measured around the centre of the frame. */}
      <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
        <View style={{ width: 168, height: 168, borderRadius: 84, borderWidth: 3, borderColor: '#ffffff' }} />
      </View>

      <View className="absolute inset-x-0 top-0 flex-row items-center justify-between px-4" style={{ paddingTop: insets.top + 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('camera.close')} onPress={() => router.back()} hitSlop={10} className="size-11 items-center justify-center rounded-full bg-black/50">
          <X size={22} color="#fff" />
        </Pressable>
        {assignment && (
          <View className="flex-row items-center gap-2 rounded-full bg-black/50 px-4 py-2">
            <Swatch hex={assignment.colorHex} size={20} />
            <Text className="text-sm font-medium text-white">{t('camera.target', { color: assignment.colorName })}</Text>
          </View>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={t('camera.flip')} onPress={() => setFacing(facing === 'back' ? 'front' : 'back')} hitSlop={10} className="size-11 items-center justify-center rounded-full bg-black/50">
          <SwitchCamera size={22} color="#fff" />
        </Pressable>
      </View>

      <View className="absolute inset-x-0 bottom-0 items-center gap-4 px-6" style={{ paddingBottom: insets.bottom + 24 }}>
        <ErrorBanner message={error ?? (group.error ? tError(group.error.code) : null)} />
        {!usable && group.data && <ErrorBanner message={t('camera.closedTitle')} />}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('camera.capture')}
          disabled={!usable || phase !== 'live'}
          onPress={() => void capture()}
          className={`size-20 items-center justify-center rounded-full border-4 border-white ${!usable ? 'opacity-40' : ''}`}
        >
          {phase === 'processing' ? <ActivityIndicator color="#fff" /> : <View className="size-14 rounded-full bg-white" />}
        </Pressable>
      </View>

      {phase === 'tooFar' && (
        <View className="absolute inset-0 items-center justify-center bg-black/70 p-6">
          <View className="w-full gap-4 rounded-3xl bg-white p-6 dark:bg-[#141a2e]">
            <Text className="text-xl font-semibold text-slate-900 dark:text-slate-50">{t('camera.tooFarTitle')}</Text>
            <Body muted>{t('camera.tooFarBody')}</Body>
            <Button label={t('camera.retake')} icon={RefreshCcw} onPress={() => setPhase('live')} />
          </View>
        </View>
      )}

      {phase === 'queued' && (
        <View className="absolute inset-0 items-center justify-center gap-3 bg-black/70">
          <View>
            <CircleCheck size={72} color="#22c55e" />
          </View>
          <Text className="text-lg font-medium text-white">{t('camera.queued')}</Text>
        </View>
      )}
    </View>
  );
}
