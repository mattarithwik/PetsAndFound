import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Body, Button, Card, ErrorNote, Muted, Notice, SectionTitle } from '@/components/ui';
import { agent, errorText } from '@/lib/api';
import { feedback } from '@/lib/motion';
import { useSession } from '@/lib/session';
import type { PickedImage } from '@/lib/uploads';

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
  const [assessment, setAssessment] = useState<Assessment>();
  const [lastFrame, setLastFrame] = useState<string>();
  const [error, setError] = useState<string>();
  const analyze = useCallback(async () => {
    if (!ready || working.current || !camera.current) return;
    working.current = true;
    setError(undefined);
    try {
      const image = await camera.current.takePictureAsync({ quality: 0.25, base64: true });
      if (!image?.base64 || !image.uri) throw new Error('The camera could not capture a frame.');
      setLastFrame(image.uri);
      const result = await agent.post<Assessment>(token!, '/v1/scene/assess', { imageBase64: image.base64, condition });
      setAssessment(result);
      assessmentHandler.current(result);
      feedback('success');
    } catch (e) { setError(errorText(e)); setScanning(false); }
    finally { working.current = false; }
  }, [condition, ready, token]);
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => { void analyze(); }, 15000);
    void analyze();
    return () => clearInterval(timer);
  }, [analyze, scanning]);
  if (!permission) return <Muted>Checking camera access…</Muted>;
  if (!permission.granted) return <Button label="Allow camera for scene assist" variant="outline" onPress={() => { void requestPermission(); }} />;
  return <View style={{ gap: 10 }}>
    <SectionTitle>PawTricia scene assist</SectionTitle>
    <Muted>Scan the current camera view for visible hazards. You decide the animal’s condition; the scan cannot diagnose injuries.</Muted>
    <CameraView ref={camera} facing="back" onCameraReady={() => setReady(true)} style={{ width: '100%', height: 260, borderRadius: 16, overflow: 'hidden' }} />
    <Button label={scanning ? 'Stop live scans' : 'Start live scans'} variant="outline" onPress={() => setScanning(!scanning)} />
    <Button label="Analyze current frame" disabled={!ready} onPress={() => { void analyze(); }} />
    {lastFrame ? <Button label="Use last frame as report photo" variant="ghost" onPress={() => { onPhoto({ uri: lastFrame, mimeType: 'image/jpeg' }); feedback('success'); }} /> : null}
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
