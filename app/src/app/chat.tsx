import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInUp, ReduceMotion } from 'react-native-reanimated';

import { choosePhotoSource } from '@/components/photos';
import {
  Badge,
  Button,
  Card,
  colors,
  displayFont,
  KeyValue,
  Muted,
  Notice,
  Row,
  SourceLink,
  SourceTag,
  Toggle,
} from '@/components/ui';
import { agent, db, errorText } from '@/lib/api';
import { useChat, type ChatMessage, type ChatRequest } from '@/lib/chat';
import { conditions, dateTime, speciesLabel } from '@/lib/format';
import { uuid } from '@/lib/ids';
import { useLive } from '@/lib/hooks';
import { usePlace } from '@/lib/place';
import { feedback, MotionPressable } from '@/lib/motion';
import { useSession } from '@/lib/session';
import { uploadPhoto, type PickedImage } from '@/lib/uploads';
import type { AgentAction, AgentResult, PendingAction, Pet } from '@/lib/types';

const toolLabels: Record<string, string> = {
  get_my_pets: 'Checked your pets',
  get_pet_profile: 'Read pet profile',
  submit_lost_report: 'Drafted lost report',
  submit_found_report: 'Drafted found report',
  create_lost_report: 'Published lost report',
  create_found_report: 'Published found report',
  search_pawsafe_reports: 'Searched PawSafe reports',
  search_bluesky: 'Searched Bluesky posts',
  search_shelter_animals: 'Searched shelter listings',
  find_nearby_shelters: 'Found nearby shelters',
  get_shelter_status: 'Checked shelter status',
  find_visual_matches: 'Compared photos',
  propose_rescue_match: 'Suggested a match',
  notify_user: 'Sent a notification',
  get_weather_alerts: 'Checked NWS alerts',
  get_preparedness_guidance: 'Looked up preparedness guidance',
  get_simulation_feedback: 'Reviewed simulation',
};

const starters = [
  'I lost my dog',
  'I found a stray cat',
  'Are there weather alerts near me?',
  'Which shelters near me are accepting animals?',
];
const enterMessage = FadeInUp.duration(180).reduceMotion(ReduceMotion.System);

export default function Chat() {
  const params = useLocalSearchParams<{ prompt?: string; reportId?: string }>();
  const { token } = useSession();
  const { place } = usePlace();
  const {
    messages,
    setMessages,
    previousRunId,
    photos,
    sending,
    uploading,
    reportId,
    openReport,
    update,
    reset,
  } = useChat();
  const [attachment, setAttachment] = useState<PickedImage>();
  const [singleAnimal, setSingleAnimal] = useState(false);
  const [text, setText] = useState(params.prompt ?? '');
  const [notice, setNotice] = useState<string>();
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    if (params.prompt) setText(params.prompt);
  }, [params.prompt]);
  useEffect(() => {
    if (params.reportId) {
      openReport(params.reportId);
      setAttachment(undefined);
      setNotice(undefined);
    }
  }, [params.reportId, openReport]);

  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [messages.length, sending]);

  const context = (attachedPhotos = photos) => ({
    ...(place ? { location: { latitude: place.latitude, longitude: place.longitude } } : {}),
    ...(place?.city ? { city: place.city } : {}),
    ...(reportId ? { reportId } : {}),
    ...(attachedPhotos.length
      ? {
          photos: attachedPhotos.slice(-5).map(({ id, storageKey, animalCount }) => ({
            id,
            storageKey,
            ...(animalCount ? { animalCount } : {}),
          })),
        }
      : {}),
  });

  const deliver = async (request: ChatRequest) => {
    update({ sending: true });
    try {
      const result = await agent.post<AgentResult>(token!, '/v1/agent/message', {
        requestId: request.requestId,
        message: request.text,
        ...(request.previousRunId ? { previousRunId: request.previousRunId } : {}),
        context: request.context,
      });
      const failed = result.status === 'failed';
      if (failed) feedback('error');
      if (!failed) update({ previousRunId: result.runId });
      const summary =
        failed && /NVIDIA_(MODEL|API_KEY) is not configured/.test(result.summary)
          ? 'Pawtricia is unavailable because the AI service hasn’t been connected. You can still file a report from the Rescue tab.'
          : result.summary;
      setMessages((list) => [
        ...list.filter((m) => !(m.from === 'agent' && m.retry?.requestId === request.requestId)),
        {
          id: result.runId,
          from: 'agent',
          text: summary,
          result,
          // A completed failure stays recorded. Only a transport retry reuses the original request ID.
          retry: failed ? { ...request, requestId: uuid() } : undefined,
        },
      ]);
    } catch (e) {
      feedback('error');
      setMessages((list) => [
        ...list.filter((m) => !(m.from === 'agent' && m.retry?.requestId === request.requestId)),
        { id: uuid(), from: 'agent', text: errorText(e), retry: request },
      ]);
    } finally {
      update({ sending: false });
    }
  };

  const send = (value = text) => {
    const trimmed = value.trim();
    if (!trimmed || sending || uploading || attachment) return;
    const request: ChatRequest = { requestId: uuid(), text: trimmed, context: context(), previousRunId };
    setMessages((list) => [...list, { id: request.requestId, from: 'user', text: trimmed }]);
    setText('');
    deliver(request);
  };

  const attach = () =>
    choosePhotoSource((image) => {
      setAttachment(image);
      setSingleAnimal(false);
      setNotice(undefined);
    }, setNotice);

  const sendPhoto = async () => {
    if (!attachment || uploading || sending) return;
    update({ uploading: true });
    setNotice(undefined);
    try {
      const uploaded = await uploadPhoto(token!, attachment);
      const nextPhotos = [
        ...photos,
        { ...uploaded, uri: attachment.uri, ...(singleAnimal ? { animalCount: 1 } : {}) },
      ].slice(-5);
      update({ photos: nextPhotos });
      const prompt = text.trim();
      setMessages((list) => [
        ...list,
        { id: uploaded.id, from: 'user', text: prompt, photoUri: attachment.uri },
      ]);
      setAttachment(undefined);
      setText('');
      await deliver({
        requestId: uuid(),
        text: prompt || "I've uploaded a photo. Please continue helping me with this pet.",
        context: context(nextPhotos),
        previousRunId,
      });
    } catch (e) {
      feedback('error');
      setNotice(errorText(e));
    } finally {
      update({ uploading: false });
    }
  };

  const confirmed = (result: AgentResult) => {
    const created = result.actions.find(
      (a) => a.tool.startsWith('create_') && a.status === 'success' && a.resourceId,
    );
    update({ previousRunId: result.runId, photos: [], reportId: created?.resourceId });
    if (created) feedback('success');
    setMessages((list) =>
      list.map((m) =>
        m.from === 'agent' && m.result?.runId === result.runId ? { ...m, text: result.summary, result } : m,
      ),
    );
  };

  return (
    <SafeAreaView style={local.screen} edges={['top', 'bottom']}>
      <Stack.Screen
        options={{
          title: 'Pawtricia',
          presentation: 'modal',
          headerShown: false,
        }}
      />
      <View style={local.bar}>
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel="Back to PawSafe"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={local.barIcon}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </MotionPressable>
        <View style={local.nameplate}>
          <Image source={require('@/assets/doghead.png')} style={local.avatar} contentFit="contain" />
          <Text accessibilityRole="header" style={local.name}>
            Pawtricia
          </Text>
        </View>
        <MotionPressable
          disabled={(!messages.length && !reportId) || sending || uploading}
          onPress={() => {
            reset();
            setAttachment(undefined);
            setText('');
            setNotice(undefined);
            router.setParams({ reportId: undefined, prompt: undefined });
          }}
          accessibilityRole="button"
          accessibilityLabel="Start a new conversation"
          style={[local.barIcon, !messages.length && !reportId && { opacity: 0.35 }]}
        >
          <Ionicons name="create-outline" size={21} color={colors.text} />
        </MotionPressable>
      </View>
      <KeyboardAvoidingView style={local.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={local.list} keyboardShouldPersistTaps="handled">
          {reportId ? (
            <Button
              compact
              variant="ghost"
              icon="document-text-outline"
              label="View the report for this conversation"
              onPress={() => router.push(`/reports/${encodeURIComponent(reportId)}`)}
            />
          ) : null}
          {!messages.length ? (
            <View style={local.intro}>
              <Image source={require('@/assets/doghead.png')} style={local.avatarLarge} contentFit="contain" />
              <Text style={local.hello}>How can I help?</Text>
              <Muted style={{ textAlign: 'center', maxWidth: 410 }}>
                Tell me about a missing pet, check nearby shelters, or ask about weather alerts in your area.
              </Muted>
              {!place && !reportId ? (
                <Notice tone="warning">Set your location on the Rescue tab so I can search nearby.</Notice>
              ) : null}
              <View style={local.starters}>
                {starters.map((s) => (
                  <MotionPressable
                    key={s}
                    accessibilityRole="button"
                    onPress={() => send(s)}
                    disabled={sending || uploading}
                    style={local.starter}
                  >
                    <Text style={local.starterText}>{s}</Text>
                  </MotionPressable>
                ))}
              </View>
            </View>
          ) : null}
          {messages.map((m) => (
            <Bubble
              key={m.id}
              message={m}
              onRetry={deliver}
              onConfirmed={confirmed}
              busy={sending || uploading}
              onSkip={() => {
                update({ photos: [], previousRunId: undefined });
                setMessages((list) =>
                  list.map((item) => (item.id === m.id ? { ...item, declined: true } : item)),
                );
              }}
            />
          ))}
          {sending ? (
            <View style={[local.bubble, local.agent]}>
              <Muted>Pawtricia is checking sources…</Muted>
            </View>
          ) : null}
        </ScrollView>
        {notice ? (
          <View style={local.noticeBar}>
            <Notice tone="danger">{notice}</Notice>
          </View>
        ) : null}
        {attachment ? (
          <View style={local.attachmentTray}>
            <Image source={{ uri: attachment.uri }} contentFit="cover" style={local.thumbnail} />
            <View style={local.flex}>
              <Toggle label="Only one animal in this photo" value={singleAnimal} onChange={setSingleAnimal} />
              <Muted>Single-animal photos can be compared with missing pets.</Muted>
            </View>
            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel="Remove attachment"
              disabled={uploading || sending}
              onPress={() => setAttachment(undefined)}
            >
              <Ionicons name="close-circle-outline" color={colors.muted} size={24} />
            </MotionPressable>
          </View>
        ) : null}
        <View style={local.composer}>
          <MotionPressable
            accessibilityRole="button"
            onPress={attach}
            disabled={uploading || sending}
            accessibilityLabel="Attach a photo"
            style={local.iconButton}
            hitSlop={6}
          >
            <Ionicons name={uploading ? 'hourglass-outline' : 'camera-outline'} size={24} color={colors.navy} />
          </MotionPressable>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message Pawtricia"
            accessibilityLabel="Message Pawtricia"
            placeholderTextColor={colors.muted}
            style={local.input}
            multiline
            maxLength={4000}
            onSubmitEditing={() => (attachment ? void sendPhoto() : send())}
            submitBehavior="submit"
            returnKeyType="send"
          />
          <MotionPressable
            accessibilityRole="button"
            onPress={() => (attachment ? void sendPhoto() : send())}
            disabled={(!text.trim() && !attachment) || sending || uploading}
            accessibilityLabel="Send"
            style={[local.send, ((!text.trim() && !attachment) || sending || uploading) && { opacity: 0.4 }]}
          >
            <Ionicons name="arrow-up" size={20} color={colors.white} />
          </MotionPressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RichText({ text, style }: { text: string; style: object }) {
  const chunks = text.split(/(\*\*[^*\n]+\*\*)/g);
  return (
    <Text style={style}>
      {chunks.map((chunk, i) =>
        chunk.startsWith('**') && chunk.endsWith('**') ? (
          <Text key={i} style={{ fontWeight: '800' }}>
            {chunk.slice(2, -2)}
          </Text>
        ) : (
          chunk
        ),
      )}
    </Text>
  );
}

function ActionSources({ action }: { action: AgentAction }) {
  const result = action.result;
  if (!result || typeof result !== 'object') return null;
  const evidence = result as {
    items?: unknown[];
    sourceUrls?: string[];
    sources?: { source: string; status: string }[];
  };
  const links = new Map<string, string>();
  for (const item of evidence.items ?? []) {
    if (!item || typeof item !== 'object' || !('sourceUrl' in item) || typeof item.sourceUrl !== 'string')
      continue;
    const label = 'headline' in item ? item.headline : 'source' in item ? item.source : 'Source record';
    links.set(item.sourceUrl, String(label));
  }
  for (const url of evidence.sourceUrls ?? []) links.set(url, url.replace(/^https?:\/\//, '').split('/')[0]);
  const unavailable = evidence.sources
    ?.filter((source) => source.status === 'unavailable')
    .map((source) => source.source);
  return (
    <>
      {!!unavailable?.length && <Muted>Unavailable sources · {unavailable.join(', ')}</Muted>}
      {Array.from(links, ([url, label]) => (
        <SourceLink key={url} url={url} label={label} />
      ))}
    </>
  );
}

function Bubble({
  message,
  onRetry,
  onConfirmed,
  busy,
  onSkip,
}: {
  message: ChatMessage;
  onRetry: (r: ChatRequest) => void;
  onConfirmed: (r: AgentResult) => void;
  busy: boolean;
  onSkip: () => void;
}) {
  if (message.from === 'user')
    return (
      <Animated.View entering={enterMessage} style={[local.bubble, local.user]}>
        {message.photoUri ? (
          <Image source={{ uri: message.photoUri }} style={local.attachment} contentFit="cover" />
        ) : null}
        {message.text ? <Text style={local.userText}>{message.text}</Text> : null}
      </Animated.View>
    );
  const result = message.result;
  const created = result?.actions.find(
    (a) => a.tool.startsWith('create_') && a.status === 'success' && a.resourceId,
  );
  return (
    <Animated.View entering={enterMessage} style={local.agentRow}>
      <Image source={require('@/assets/doghead.png')} style={local.avatar} contentFit="contain" />
      <View style={[local.bubble, local.agent, message.retry && local.failed]}>
        <RichText text={message.text} style={local.agentText} />
        {result?.actions.length ? (
          <View style={local.actions}>
            {result.actions.map((a, i) => (
              <View key={i}>
                <Row>
                  <Ionicons
                    name={
                      a.status === 'success'
                        ? 'checkmark-circle'
                        : a.status === 'awaiting_confirmation'
                          ? 'time-outline'
                          : 'alert-circle-outline'
                    }
                    size={14}
                    color={a.status === 'success' ? colors.success : colors.warning}
                  />
                  <Text style={local.actionText}>
                    {toolLabels[a.tool] ?? a.tool}
                    {a.status !== 'success' && a.status !== 'awaiting_confirmation' ? ' (unavailable)' : ''}
                  </Text>
                </Row>
                <ActionSources action={a} />
              </View>
            ))}
          </View>
        ) : null}
        {result?.pendingAction && result.status === 'awaiting_confirmation' && !message.declined ? (
          <Preview
            runId={result.runId}
            action={result.pendingAction}
            onConfirmed={onConfirmed}
            onSkip={onSkip}
          />
        ) : null}
        {message.declined ? <Muted>Report draft declined.</Muted> : null}
        {created ? (
          <Button
            label="Open report"
            compact
            variant="outline"
            onPress={() => router.push(`/reports/${created.resourceId}`)}
          />
        ) : null}
        {result?.possibleMatchIds.map((id, i) => (
          <Button
            key={id}
            label={`View possible match ${i + 1}`}
            icon="images-outline"
            compact
            variant="ghost"
            onPress={() => router.push(`/matches/${encodeURIComponent(id)}`)}
          />
        ))}
        {message.retry ? (
          <Button
            label="Try again"
            icon="refresh"
            compact
            variant="outline"
            disabled={busy}
            onPress={() => onRetry(message.retry!)}
          />
        ) : null}
        {result?.status === 'completed' ? <SourceTag kind="ai" /> : null}
      </View>
    </Animated.View>
  );
}

function Preview({
  runId,
  action,
  onConfirmed,
  onSkip,
}: {
  runId: string;
  action: PendingAction;
  onConfirmed: (r: AgentResult) => void;
  onSkip: () => void;
}) {
  const { token } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { messages } = useChat();
  const p = action.payload as Record<string, unknown>;
  const lost = action.operation === 'create_lost_report';
  const photoIds = new Set(Array.isArray(p.photos) ? p.photos.map((photo) => photo?.id) : []);
  const previews = messages.filter(
    (message) => message.from === 'user' && message.photoUri && photoIds.has(message.id),
  );
  const petId = typeof p.petId === 'string' ? p.petId : '';
  const pet = useLive(
    () => (lost && petId ? db.read<Pet | null>(token!, 'pet', petId) : Promise.resolve(null)),
    'chat-preview-' + runId,
  );

  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await agent.post<AgentResult>(token!, '/v1/agent/confirm-action', {
        runId,
        confirmed: true,
      });
      onConfirmed(result);
      const id = result.actions.find((a) => a.tool === action.operation)?.resourceId;
      if (id) agent.post(token!, '/v1/matching/search', { reportId: id }).catch(() => undefined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tone="info">
      <Row>
        <Badge
          label={lost ? 'Lost report preview' : 'Found report preview'}
          tone={lost ? 'warning' : 'success'}
        />
      </Row>
      {!lost && typeof p.species === 'string' ? (
        <KeyValue label="Animal" value={[speciesLabel(p.species), p.breed].filter(Boolean).join(' · ')} />
      ) : null}
      {lost ? <KeyValue label="Pet" value={pet.data?.name ?? (pet.loading ? 'Loading…' : petId)} /> : null}
      <KeyValue label={lost ? 'Last seen' : 'Found'} value={dateTime(String(p.observedAt ?? ''))} />
      {p.generalLocation ? <KeyValue label="Area" value={String(p.generalLocation)} /> : null}
      <KeyValue
        label="Reported location"
        value={`${Number(p.latitude).toFixed(4)}, ${Number(p.longitude).toFixed(4)}`}
      />
      {Array.isArray(p.colors) && p.colors.length ? (
        <KeyValue label="Colors" value={p.colors.join(', ')} />
      ) : null}
      {typeof p.condition === 'string' ? (
        <KeyValue
          label="Condition"
          value={conditions.find((c) => c.value === p.condition)?.label ?? p.condition}
        />
      ) : null}
      {typeof p.description === 'string' && p.description ? (
        <KeyValue label="Details" value={p.description} />
      ) : null}
      <KeyValue label="Attached photos" value={String(photoIds.size)} />
      {previews.length ? (
        <Row>
          {previews.map(
            (photo) =>
              photo.from === 'user' && (
                <Image
                  key={photo.id}
                  source={{ uri: photo.photoUri }}
                  style={local.thumbnail}
                  contentFit="cover"
                  accessibilityLabel="Photo included in this report"
                />
              ),
          )}
        </Row>
      ) : null}
      <Muted>Only the species, time and an approximate area are shown publicly.</Muted>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Confirm and publish" icon="checkmark" compact onPress={confirm} loading={busy} />
      <Button label="Don't publish" variant="ghost" compact onPress={onSkip} disabled={busy} />
    </Card>
  );
}

const local = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sky },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: 14,
  },
  barIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#D9EEFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameplate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.pale,
    borderRadius: 30,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  name: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -1 },
  sheet: {
    flex: 1,
    alignSelf: 'center',
    width: '96%',
    maxWidth: 740,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  hello: { fontFamily: displayFont, fontSize: 36, fontWeight: 'bold', letterSpacing: -1, color: colors.text },
  flex: { flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 24 },
  intro: { alignItems: 'center', gap: 12, paddingVertical: 30 },
  avatarLarge: { width: 72, height: 72 },
  avatar: { width: 28, height: 28, marginTop: 4 },
  starters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 },
  starter: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.baby,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  starterText: { color: colors.navy, fontWeight: '600' },
  bubble: { borderRadius: 18, padding: 12, maxWidth: '85%', gap: 8 },
  user: {
    alignSelf: 'flex-end',
    backgroundColor: colors.white,
    borderColor: colors.sky,
    borderWidth: 1.5,
    borderBottomRightRadius: 4,
  },
  userText: { color: colors.navy, fontSize: 16, lineHeight: 22 },
  attachment: { width: 160, height: 160, borderRadius: 12 },
  attachmentTray: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    backgroundColor: colors.pale,
  },
  thumbnail: { width: 54, height: 54, borderRadius: 10 },
  agentRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  agent: { backgroundColor: colors.pale, borderBottomLeftRadius: 4, flexShrink: 1 },
  failed: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  agentText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  actions: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  actionText: { color: colors.muted, fontSize: 13 },
  noticeBar: { paddingHorizontal: 16 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  iconButton: { padding: 8 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 21,
    backgroundColor: colors.pale,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 16,
    color: colors.text,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
