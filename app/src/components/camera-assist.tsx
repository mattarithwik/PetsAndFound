import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Body, Button, Card, ErrorNote, Muted, Notice, SectionTitle } from '@/components/ui';
import { agent, errorText } from '@/lib/api';
import { feedback } from '@/lib/motion';
import { useSession } from '@/lib/session';
import type { PickedImage } from '@/lib/uploads';
import { pickImage } from '@/lib/uploads';

type Assessment = { environment: string; visibleConcerns: string[]; uncertainty: string; nextSteps: string[]; reportedCondition: string };

export function CameraAssist({ condition, onPhoto, onAssessment }: { condition: string; onPhoto: (image: PickedImage) => void; onAssessment: (assessment: Assessment) => void }) {
  const { token } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const assessmentHandler = useRef(onAssessment);
  useEffect(() => { assessmentHandler.current = onAssessment; }, [onAssessment]);
  const working = useRef(false);
  const [ready, setReady] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [assessment, setAssessment] = useState<Assessment>();
  const [lastFrame, setLastFrame] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const assess = useCallback(async (base64: string, uri: string) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(undefined);
    setAssessment(undefined);
    try {
      const result = await agent.post<Assessment>(token!, '/v1/scene/assess', { imageBase64: base64, condition });
      setLastFrame(uri);
      setAssessment(result);
      assessmentHandler.current(result);
      feedback('success');
    } catch (e) { setError(errorText(e)); setScanning(false); }
    finally { working.current = false; setBusy(false); }
  }, [condition, token]);
  const choose = async () => {
    try {
      setScanning(false);
      setCameraOpen(false);
      const image = await pickImage('library');
      if (!image) return;
      // The vision endpoint accepts JPEG and caps the base64 payload at 2 MB.
      const context = ImageManipulator.manipulate(image.uri, { maxWidth: 1024, maxHeight: 1024 });
      const rendered = await context.renderAsync();
      const prepared = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.55, base64: true });
      if (!prepared.base64 || prepared.base64.length > 2_000_000) throw new Error('This photo is too large to analyze. Choose a smaller photo.');
      setLastFrame(image.uri);
      onPhoto(image);
      await assess(prepared.base64, image.uri);
    } catch (e) { setError(errorText(e)); }
  };
  const analyze = useCallback(async () => {
    if (!ready || working.current || !camera.current) return;
    try {
      const image = await camera.current.takePictureAsync({ quality: 0.25, base64: true });
      if (!image?.base64 || !image.uri) throw new Error('The camera could not capture a frame.');
      await assess(image.base64, image.uri);
    } catch (e) { setError(errorText(e)); setScanning(false); }
  }, [assess, ready]);
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => { void analyze(); }, 15000);
    void analyze();
    return () => clearInterval(timer);
  }, [analyze, scanning]);
  return <View style={{ gap: 10 }}>
    <SectionTitle>Check the surroundings</SectionTitle>
    <Muted>Choose a photo for visible hazards and next steps. Confirm the animal’s condition yourself.</Muted>
    <Button label={busy ? 'Analyzing photo…' : 'Choose photo and get next steps'} disabled={busy} onPress={() => { void choose(); }} />
    {lastFrame ? <Image source={{ uri: lastFrame }} contentFit="cover" style={{ width: '100%', height: 180, borderRadius: 16 }} /> : null}
    <Button label={cameraOpen ? 'Close live camera' : 'Use live camera instead'} variant="ghost" onPress={() => { setScanning(false); setCameraOpen(!cameraOpen); }} />
    {cameraOpen && (!permission ? <Muted>Checking camera access…</Muted> : !permission.granted
      ? <Button label="Allow live camera access" variant="outline" onPress={() => { void requestPermission(); }} />
      : <>
        <CameraView ref={camera} facing="back" onCameraReady={() => setReady(true)} style={{ width: '100%', height: 260, borderRadius: 16, overflow: 'hidden' }} />
        <Button label={scanning ? 'Stop live scans' : 'Start live scans'} variant="outline" onPress={() => setScanning(!scanning)} />
        <Button label="Check this view" disabled={!ready || busy} onPress={() => { void analyze(); }} />
      </>)}
    {lastFrame ? <Button label="Use this photo in report" variant="ghost" onPress={() => { onPhoto({ uri: lastFrame, mimeType: 'image/jpeg' }); feedback('success'); }} /> : null}
    <ErrorNote error={error} />
    {assessment ? <Card tone="info">
      <Body>{assessment.environment}</Body>
      {assessment.visibleConcerns.map((item, index) => <Muted key={index}>• {item}</Muted>)}
      <Muted>{assessment.uncertainty}</Muted>
      {assessment.nextSteps.map((step, index) => <Muted key={index}>{index + 1}. {step}</Muted>)}
      <Notice tone="warning">This is a visual aid, not a medical assessment or a rescue dispatch.</Notice>
    </Card> : null}
  </View>;
}
