import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { choosePhotoSource } from '@/components/photos';
import { Badge, Button, Card, colors, KeyValue, Muted, Notice, Row, SourceTag, Strong } from '@/components/ui';
import { agent, errorText } from '@/lib/api';
import { useChat, type ChatMessage, type ChatRequest } from '@/lib/chat';
import { conditions, dateTime, speciesLabel } from '@/lib/format';
import { uuid } from '@/lib/ids';
import { usePlace } from '@/lib/place';
import { useSession } from '@/lib/session';
import { uploadPhoto } from '@/lib/uploads';
import type { AgentResult, PendingAction } from '@/lib/types';

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

const starters = ['I lost my dog', 'I found a stray cat', 'Are there weather alerts near me?', 'Which shelters near me are accepting animals?'];

export default function Chat() {
  const params = useLocalSearchParams<{ prompt?: string; reportId?: string }>();
  const { token } = useSession();
  const { place } = usePlace();
  const { messages, setMessages, previousRunId, setPreviousRunId, photos, setPhotos, reset } = useChat();
  const [text, setText] = useState(params.prompt ?? '');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string>();
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    if (params.prompt) setText(params.prompt);
  }, [params.prompt]);

  useEffect(() => {
    const timer = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [messages.length, sending]);

  const context = (attachedPhotos = photos) => ({
    ...(place ? { location: { latitude: place.latitude, longitude: place.longitude } } : {}),
    ...(place?.city ? { city: place.city } : {}),
    ...(params.reportId ? { reportId: params.reportId } : {}),
    ...(attachedPhotos.length ? { photos: attachedPhotos.slice(-5).map(({ id, storageKey, animalCount }) => ({ id, storageKey, ...(animalCount ? { animalCount } : {}) })) } : {}),
  });

  const deliver = async (request: ChatRequest) => {
    setSending(true);
    try {
      const result = await agent.post<AgentResult>(token!, '/v1/agent/message', {
        requestId: request.requestId,
        message: request.text,
        ...(request.previousRunId ? { previousRunId: request.previousRunId } : {}),
        context: context(request.photos),
      });
      setPreviousRunId(result.runId);
      setMessages((list) => [...list.filter((m) => !(m.from === 'agent' && m.retry?.requestId === request.requestId)), { id: result.runId, from: 'agent', text: result.summary, result }]);
    } catch (e) {
      setMessages((list) => [
        ...list.filter((m) => !(m.from === 'agent' && m.retry?.requestId === request.requestId)),
        { id: uuid(), from: 'agent', text: errorText(e), retry: request },
      ]);
    } finally {
      setSending(false);
    }
  };

  const send = (value = text) => {
    const trimmed = value.trim();
    if (!trimmed || sending || uploading) return;
    const request: ChatRequest = { requestId: uuid(), text: trimmed, photos, previousRunId };
    setMessages((list) => [...list, { id: request.requestId, from: 'user', text: trimmed }]);
    setText('');
    deliver(request);
  };

  const attach = () =>
    choosePhotoSource(
      async (image) => {
        setUploading(true);
        setNotice(undefined);
        try {
          const uploaded = await uploadPhoto(token!, image);
          const nextPhotos = [...photos, { ...uploaded, uri: image.uri, animalCount: 1 }];
          setPhotos(nextPhotos);
          setMessages((list) => [...list, { id: uploaded.id, from: 'user', text: 'Attached a photo', photoUri: image.uri }]);
          await deliver({
            requestId: uuid(),
            text: "I've uploaded a photo. Please continue helping me with this pet.",
            photos: nextPhotos,
            previousRunId,
          });
        } catch (e) {
          setNotice(errorText(e));
        } finally {
          setUploading(false);
        }
      },
      setNotice,
    );

  const confirmed = (result: AgentResult) => {
    setPreviousRunId(result.runId);
    setMessages((list) => list.map((m) => (m.from === 'agent' && m.result?.runId === result.runId ? { ...m, text: result.summary, result } : m)));
  };

  return (
    <SafeAreaView style={local.screen} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Pawtricia',
          presentation: 'modal',
          headerRight: () =>
            messages.length ? (
              <Pressable onPress={reset} accessibilityLabel="Start a new conversation" hitSlop={10}>
                <Ionicons name="create-outline" size={22} color={colors.navy} />
              </Pressable>
            ) : null,
        }}
      />
      <KeyboardAvoidingView style={local.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}>
        <ScrollView ref={scroll} contentContainerStyle={local.list} keyboardShouldPersistTaps="handled">
          {!messages.length ? (
            <View style={local.intro}>
              <Image source={require('@/assets/doghead.png')} style={local.avatarLarge} contentFit="contain" />
              <Strong>Hi, I'm Pawtricia</Strong>
              <Muted style={{ textAlign: 'center' }}>
                I can draft lost and found reports, search shelters and permitted public posts, compare photos and check official alerts. I'll always ask before publishing anything.
              </Muted>
              {!place ? <Notice tone="warning">Set your location on the Rescue tab so I can search nearby.</Notice> : null}
              <View style={local.starters}>
                {starters.map((s) => (
                  <Pressable key={s} onPress={() => send(s)} style={({ pressed }) => [local.starter, pressed && { opacity: 0.7 }]}>
                    <Text style={local.starterText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {messages.map((m) => (
            <Bubble key={m.id} message={m} onRetry={deliver} onConfirmed={confirmed} busy={sending} />
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
        <View style={local.composer}>
          <Pressable onPress={attach} disabled={uploading || sending} accessibilityLabel="Attach a photo" style={local.iconButton} hitSlop={6}>
            <Ionicons name={uploading ? 'hourglass-outline' : 'camera-outline'} size={24} color={colors.navy} />
          </Pressable>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message Pawtricia"
            placeholderTextColor={colors.muted}
            style={local.input}
            multiline
            maxLength={4000}
            onSubmitEditing={() => send()}
            submitBehavior="submit"
            returnKeyType="send"
          />
          <Pressable onPress={() => send()} disabled={!text.trim() || sending || uploading} accessibilityLabel="Send" style={[local.send, (!text.trim() || sending || uploading) && { opacity: 0.4 }]}>
            <Ionicons name="arrow-up" size={20} color={colors.white} />
          </Pressable>
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

function Bubble({ message, onRetry, onConfirmed, busy }: { message: ChatMessage; onRetry: (r: ChatRequest) => void; onConfirmed: (r: AgentResult) => void; busy: boolean }) {
  const [skipped, setSkipped] = useState(false);
  if (message.from === 'user')
    return (
      <View style={[local.bubble, local.user]}>
        {message.photoUri ? <Image source={{ uri: message.photoUri }} style={local.attachment} contentFit="cover" /> : null}
        {message.photoUri ? null : <Text style={local.userText}>{message.text}</Text>}
      </View>
    );
  const result = message.result;
  const created = result?.actions.find((a) => a.tool.startsWith('create_') && a.status === 'success' && a.resourceId);
  return (
    <View style={local.agentRow}>
      <Image source={require('@/assets/doghead.png')} style={local.avatar} contentFit="contain" />
      <View style={[local.bubble, local.agent, message.retry && local.failed]}>
        <RichText text={message.text} style={local.agentText} />
        {result?.actions.length ? (
          <View style={local.actions}>
            {result.actions.map((a, i) => (
              <Row key={i}>
                <Ionicons name={a.status === 'success' ? 'checkmark-circle' : a.status === 'awaiting_confirmation' ? 'time-outline' : 'alert-circle-outline'} size={14} color={a.status === 'success' ? colors.success : colors.warning} />
                <Text style={local.actionText}>
                  {toolLabels[a.tool] ?? a.tool}
                  {a.status !== 'success' && a.status !== 'awaiting_confirmation' ? ' (unavailable)' : ''}
                </Text>
              </Row>
            ))}
          </View>
        ) : null}
        {result?.pendingAction && result.status === 'awaiting_confirmation' && !skipped ? (
          <Preview runId={result.runId} action={result.pendingAction} onConfirmed={onConfirmed} onSkip={() => setSkipped(true)} />
        ) : null}
        {skipped ? <Muted>Nothing was published.</Muted> : null}
        {created ? <Button label="Open report" compact variant="outline" onPress={() => router.push(`/reports/${created.resourceId}`)} /> : null}
        {result?.possibleMatchIds.map((id, i) => (
          <Button key={id} label={`View possible match ${i + 1}`} icon="images-outline" compact variant="ghost" onPress={() => router.push(`/matches/${encodeURIComponent(id)}`)} />
        ))}
        {message.retry ? <Button label="Try again" icon="refresh" compact variant="outline" disabled={busy} onPress={() => onRetry(message.retry!)} /> : null}
        {result ? <SourceTag kind="ai" /> : null}
      </View>
    </View>
  );
}

function Preview({ runId, action, onConfirmed, onSkip }: { runId: string; action: PendingAction; onConfirmed: (r: AgentResult) => void; onSkip: () => void }) {
  const { token } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const p = action.payload as Record<string, unknown>;
  const lost = action.operation === 'create_lost_report';
  const photos = Array.isArray(p.photos) ? p.photos.length : 0;

  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await agent.post<AgentResult>(token!, '/v1/agent/confirm-action', { runId, confirmed: true });
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
        <Badge label={lost ? 'Lost report preview' : 'Found report preview'} tone={lost ? 'warning' : 'success'} />
      </Row>
      {!lost && typeof p.species === 'string' ? <KeyValue label="Animal" value={[speciesLabel(p.species), p.breed].filter(Boolean).join(' · ')} /> : null}
      <KeyValue label={lost ? 'Last seen' : 'Found'} value={dateTime(String(p.observedAt ?? ''))} />
      <KeyValue label="Area" value={String(p.generalLocation || `${Number(p.latitude).toFixed(3)}, ${Number(p.longitude).toFixed(3)}`)} />
      {typeof p.condition === 'string' ? <KeyValue label="Condition" value={conditions.find((c) => c.value === p.condition)?.label ?? p.condition} /> : null}
      {typeof p.description === 'string' && p.description ? <KeyValue label="Details" value={p.description} /> : null}
      {!lost ? <KeyValue label="Photos" value={String(photos)} /> : null}
      <Muted>Only the species, time and an approximate area are shown publicly.</Muted>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label="Confirm and publish" icon="checkmark" compact onPress={confirm} loading={busy} />
      <Button label="Don't publish" variant="ghost" compact onPress={onSkip} disabled={busy} />
    </Card>
  );
}

const local = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 24 },
  intro: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  avatarLarge: { width: 72, height: 72 },
  avatar: { width: 28, height: 28, marginTop: 4 },
  starters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 },
  starter: { borderRadius: 999, borderWidth: 1, borderColor: colors.baby, backgroundColor: colors.white, paddingHorizontal: 14, paddingVertical: 8 },
  starterText: { color: colors.navy, fontWeight: '600' },
  bubble: { borderRadius: 18, padding: 12, maxWidth: '85%', gap: 8 },
  user: { alignSelf: 'flex-end', backgroundColor: colors.navy, borderBottomRightRadius: 4 },
  userText: { color: colors.white, fontSize: 16, lineHeight: 22 },
  attachment: { width: 160, height: 160, borderRadius: 12 },
  agentRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  agent: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4, flexShrink: 1 },
  failed: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  agentText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  actions: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  actionText: { color: colors.muted, fontSize: 13 },
  noticeBar: { paddingHorizontal: 16 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white },
  iconButton: { padding: 8 },
  input: { flex: 1, minHeight: 42, maxHeight: 120, borderRadius: 21, backgroundColor: colors.pale, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16, color: colors.text },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
});
