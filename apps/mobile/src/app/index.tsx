import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type ViewName = 'home' | 'game' | 'chat' | 'profile' | 'settings';
type Role = 'owner' | 'shelter';
type StoryStep = 'situation' | 'animal' | 'story';

const blue = '#4099E6';
const darkBlue = '#0064BC';
const paleBlue = '#E8F5FF';
const situations = ['Hurricane / flooding', 'Tornado', 'Wildfires', 'Winter storms', 'Earthquakes'];
const animals = ['Dog', 'Cat', 'Snake', 'Bird', 'Rabbit'];

export default function HomeScreen() {
  const [role, setRole] = useState<Role | undefined>();
  const [view, setView] = useState<ViewName>('home');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [camera, setCamera] = useState<CameraView | null>(null);
  const [cameraUri, setCameraUri] = useState<string>();
  const [messages, setMessages] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [storyStep, setStoryStep] = useState<StoryStep>('situation');
  const [situation, setSituation] = useState('');
  const [animal, setAnimal] = useState('');
  const [scene, setScene] = useState(0);
  const [shelterPassword, setShelterPassword] = useState('');
  const [shelterLoggedIn, setShelterLoggedIn] = useState(false);

  const openCamera = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to scan a pet or injured animal.');
        return;
      }
    }
    setCameraOpen(true);
  };

  const capture = async () => {
    if (!camera) return;
    const photo = await camera.takePictureAsync({ quality: 0.8 });
    if (photo?.uri) {
      setCameraUri(photo.uri);
      setCameraOpen(false);
      setView('chat');
      setMessages((current) => [...current, 'Photo captured. Pawtricia can review this scan.']);
    }
  };

  const sendMessage = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setMessages((current) => [...current, trimmed]);
    setMessage('');
  };

  if (!role) {
    return (
      <SafeAreaView style={styles.auth}>
        <Image source={require('@/assets/logo.png')} style={styles.logo} contentFit="contain" />
        <Text style={styles.authTitle}>Hello!</Text>
        <Text style={styles.authQuestion}>Are you a</Text>
        <Pressable style={styles.primaryButton} onPress={() => setRole('owner')}>
          <Text style={styles.primaryButtonText}>Pet Owner</Text>
        </Pressable>
        <Pressable style={styles.outlineButton} onPress={() => setRole('shelter')}>
          <Text style={styles.outlineButtonText}>Shelter Member</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (role === 'shelter' && !shelterLoggedIn) {
    return (
      <SafeAreaView style={styles.shelterLogin}>
        <View style={styles.shelterCard}>
          <Text style={styles.eyebrow}>PawSafe</Text>
          <Text style={styles.shelterTitle}>ShelterDash</Text>
          <Text style={styles.bodyText}>Coordinate care and help injured animals get home safely.</Text>
          <Text style={styles.label}>Password</Text>
          <TextInput
            value={shelterPassword}
            onChangeText={setShelterPassword}
            secureTextEntry
            placeholder="Enter your password"
            style={styles.input}
          />
          <Pressable
            style={styles.primaryButton}
            onPress={() => shelterPassword.trim() && setShelterLoggedIn(true)}>
            <Text style={styles.primaryButtonText}>Log in</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (role === 'shelter') {
    return (
      <SafeAreaView style={styles.shelterScreen}>
        <View style={styles.shelterTop}><Text style={styles.shelterTopText}>ShelterDash</Text></View>
        <ScrollView contentContainerStyle={styles.shelterContent}>
          <View style={styles.reportCard}><View><Text style={styles.cardTitle}>New Reports</Text><Text style={styles.muted}>New animal reports need review.</Text></View><Text style={styles.reportCount}>+12</Text></View>
          <Text style={styles.sectionTitle}>Injured animals nearby</Text>
          <View style={styles.map}><Text style={styles.mapText}>3 injured animals{'\n'}within 5 miles</Text><Text style={styles.mapPaws}>🐾　🐾　🐾</Text></View>
          <Text style={styles.sectionTitle}>Disaster Care</Text>
          <View style={styles.reportCard}><Text style={styles.cardTitle}>Active alerts</Text><Text style={styles.muted}>View nearby emergencies</Text></View>
          <View style={styles.reportCard}><Text style={styles.cardTitle}>Rescue resources</Text><Text style={styles.muted}>Coordinate shelter support</Text></View>
          <Text style={styles.sectionTitle}>Potential Matches</Text>
          <View style={styles.reportCard}><Text style={styles.cardTitle}>Buddy</Text><Text style={styles.muted}>85% match</Text></View>
          <View style={styles.reportCard}><Text style={styles.cardTitle}>Whiskers</Text><Text style={styles.muted}>92% match</Text></View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (cameraOpen) {
    return (
      <View style={styles.cameraScreen}>
        <CameraView ref={setCamera} style={StyleSheet.absoluteFill} facing="back" />
        <SafeAreaView style={styles.cameraControls}>
          <Pressable style={styles.cameraClose} onPress={() => setCameraOpen(false)}><Text style={styles.cameraCloseText}>×</Text></Pressable>
          <Pressable style={styles.captureButton} onPress={capture}><View style={styles.captureInner} /></Pressable>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.app}>
      {view === 'home' && <Home onAction={setView} />}
      {view === 'game' && (
        <Game
          step={storyStep}
          situation={situation}
          animal={animal}
          scene={scene}
          onSituation={(value) => { setSituation(value); setStoryStep('animal'); }}
          onAnimal={(value) => { setAnimal(value); setStoryStep('story'); }}
          onChoice={() => setScene((value) => Math.min(value + 1, 2))}
          onRestart={() => { setStoryStep('situation'); setSituation(''); setAnimal(''); setScene(0); }}
        />
      )}
      {view === 'chat' && (
        <Chat
          messages={messages}
          message={message}
          cameraUri={cameraUri}
          onMessage={setMessage}
          onSend={sendMessage}
          onCamera={openCamera}
        />
      )}
      {view === 'profile' && <Profile />}
      {view === 'settings' && <Settings onSignOut={() => setRole(undefined)} />}
      <View style={styles.nav}>
        {([
          ['home', 'home-outline'],
          ['game', 'game-controller-outline'],
          ['profile', 'paw-outline'],
          ['settings', 'settings-outline'],
        ] as const).map(([name, icon]) => (
          <Pressable key={name} onPress={() => setView(name)} style={styles.navItem}>
            <Ionicons name={icon} size={25} color={view === name ? darkBlue : blue} />
          </Pressable>
        ))}
      </View>
      {view !== 'chat' && <Pressable style={styles.chatFloat} onPress={() => setView('chat')}><Ionicons name="chatbubble-ellipses-outline" size={23} color="#fff" /></Pressable>}
    </SafeAreaView>
  );
}

function Home({ onAction }: { onAction: (view: ViewName) => void }) {
  return <ScrollView style={styles.flex} contentContainerStyle={styles.homeContent}>
    <View style={styles.homeHeader}><Text style={styles.homeTitle}>We're here to help. ♡</Text></View>
    {['Lost a pet', 'Found a pet', 'Need help right now?'].map((title, index) => <Pressable key={title} style={[styles.actionCard, index === 2 && styles.emergency]} onPress={() => onAction(index === 2 ? 'chat' : 'profile')}><Text style={styles.actionTitle}>{title}</Text><Text style={styles.muted}>{index === 0 ? 'Tell us what happened and we’ll help.' : index === 1 ? 'Share where you found them.' : 'Get support for injured animals.'}</Text></Pressable>)}
    <Text style={styles.sectionTitle}>Potential match found</Text>
    <View style={styles.gallery}>{['🐶 Buddy', '🐕 Max', '🐩 Waffles'].map((pet) => <View style={styles.galleryCard} key={pet}><Text style={styles.galleryEmoji}>{pet.split(' ')[0]}</Text><Text style={styles.cardTitle}>{pet.slice(2)}</Text><Text style={styles.muted}>85% similar</Text></View>)}</View>
  </ScrollView>;
}

function Game({ step, situation, animal, scene, onSituation, onAnimal, onChoice, onRestart }: { step: StoryStep; situation: string; animal: string; scene: number; onSituation: (value: string) => void; onAnimal: (value: string) => void; onChoice: () => void; onRestart: () => void }) {
  const prompt = scene === 0 ? `A ${situation} is unfolding and you spot a ${animal}. What is your first move?` : `The ${animal} is safer, but help is still needed. What do you do next?`;
  return <ScrollView style={styles.flex} contentContainerStyle={styles.gameContent}><Text style={styles.eyebrow}>Safety story</Text><Text style={styles.gameTitle}>Ready, pet hero?</Text>{step === 'situation' && <><Text style={styles.sectionTitle}>Choose a situation</Text>{situations.map((item) => <Option key={item} label={item} onPress={() => onSituation(item)} />)}</>}{step === 'animal' && <><Text style={styles.sectionTitle}>Who needs help?</Text>{animals.map((item) => <Option key={item} label={item} onPress={() => onAnimal(item)} />)}</>}{step === 'story' && <View style={styles.story}><Text style={styles.muted}>Scene {Math.min(scene + 1, 2)} of 2</Text><Text style={styles.storyText}>{scene >= 2 ? 'Great work! You kept yourself safe and connected the animal with help.' : prompt}</Text>{scene < 2 ? <><Option label="Move to safety and keep the animal calm" onPress={onChoice} /><Option label="Call for help and share the location" onPress={onChoice} /></> : <Pressable style={styles.primaryButton} onPress={onRestart}><Text style={styles.primaryButtonText}>Play another story</Text></Pressable>}</View>}</ScrollView>;
}

function Option({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable style={styles.option} onPress={onPress}><Text style={styles.optionText}>{label}</Text></Pressable>; }

function Chat({ messages, message, cameraUri, onMessage, onSend, onCamera }: { messages: string[]; message: string; cameraUri?: string; onMessage: (value: string) => void; onSend: () => void; onCamera: () => void }) {
  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={styles.chatHeader}><Image source={require('@/assets/doghead.png')} style={styles.avatar} /><Text style={styles.chatTitle}>Pawtricia</Text></View><ScrollView style={styles.chatMessages}>{!messages.length && <Text style={styles.assistant}>Hello! I am Pawtricia. How can I help you today?</Text>}{cameraUri && <Image source={{ uri: cameraUri }} style={styles.photoPreview} />}{messages.map((item, index) => <Text style={styles.userMessage} key={`${item}-${index}`}>{item}</Text>)}</ScrollView><View style={styles.composer}><TextInput value={message} onChangeText={onMessage} placeholder="Type a message..." style={styles.messageInput} /><Pressable style={styles.cameraButton} onPress={onCamera}><Ionicons name="camera-outline" size={23} color="#fff" /></Pressable><Pressable style={styles.sendButton} onPress={onSend}><Ionicons name="arrow-up" size={24} color="#fff" /></Pressable></View></KeyboardAvoidingView>;
}

function Profile() { return <ScrollView contentContainerStyle={styles.profile}><Text style={styles.gameTitle}>Tell us about your pet</Text><View style={styles.petPlaceholder}><MaterialCommunityIcons name="paw" size={50} color={blue} /><Text style={styles.muted}>Add photo</Text></View>{['Pet name', 'Age', 'Identification features', 'Any health conditions'].map((label) => <TextInput key={label} placeholder={label} style={styles.input} multiline={label.includes('features') || label.includes('conditions')} />)}<Pressable style={styles.primaryButton}><Text style={styles.primaryButtonText}>Save pet profile</Text></Pressable></ScrollView>; }
function Settings({ onSignOut }: { onSignOut: () => void }) { return <ScrollView contentContainerStyle={styles.profile}><Text style={styles.gameTitle}>Settings</Text><Text style={styles.bodyText}>Keep PawSafe working the way you need.</Text>{['Emergency alerts', 'Missing pet alerts', 'Location/geofence alerts', 'Urgent health concerns'].map((item) => <View style={styles.settingRow} key={item}><Text style={styles.cardTitle}>{item}</Text><Text style={styles.toggle}>ON</Text></View>)}<Pressable style={styles.outlineButton} onPress={onSignOut}><Text style={styles.outlineButtonText}>Sign out</Text></Pressable></ScrollView>; }

const styles = StyleSheet.create({
  flex: { flex: 1 }, app: { flex: 1, backgroundColor: '#F7FBFF' }, auth: { flex: 1, backgroundColor: blue, alignItems: 'center', justifyContent: 'center', padding: 28 }, logo: { width: 120, height: 100 }, authTitle: { color: '#fff', fontSize: 44, fontWeight: '700', marginTop: 16 }, authQuestion: { color: '#fff', fontSize: 18, marginBottom: 22 }, primaryButton: { backgroundColor: blue, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 10 }, primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' }, outlineButton: { borderWidth: 2, borderColor: blue, borderRadius: 14, padding: 12, alignItems: 'center', marginTop: 10, width: '100%' }, outlineButtonText: { color: blue, fontSize: 16, fontWeight: '700' }, shelterLogin: { flex: 1, backgroundColor: blue, justifyContent: 'center', padding: 20 }, shelterCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24 }, eyebrow: { color: darkBlue, fontWeight: '800', fontSize: 13 }, shelterTitle: { fontSize: 40, fontWeight: '800', marginVertical: 8 }, bodyText: { color: '#536777', lineHeight: 21 }, label: { fontWeight: '700', marginTop: 20, marginBottom: 6 }, input: { borderWidth: 1, borderColor: '#AED9FF', borderRadius: 12, padding: 12, backgroundColor: '#fff', marginTop: 10, minHeight: 46 }, shelterScreen: { flex: 1, backgroundColor: '#F7FBFF' }, shelterTop: { backgroundColor: blue, padding: 22 }, shelterTopText: { color: '#fff', fontSize: 22, fontWeight: '700' }, shelterContent: { padding: 20, gap: 12 }, reportCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#D5EAFF' }, cardTitle: { fontSize: 16, fontWeight: '700', textTransform: 'capitalize' }, muted: { color: '#62727F', fontSize: 12, marginTop: 3 }, reportCount: { color: darkBlue, fontWeight: '800', fontSize: 18 }, sectionTitle: { fontSize: 20, fontWeight: '800', marginTop: 14, marginBottom: 4 }, map: { height: 180, borderRadius: 18, backgroundColor: '#DDF0FF', justifyContent: 'center', alignItems: 'center' }, mapText: { textAlign: 'center', color: darkBlue, fontWeight: '800' }, mapPaws: { fontSize: 24, marginTop: 20 }, homeContent: { paddingBottom: 100 }, homeHeader: { backgroundColor: blue, padding: 30, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, alignItems: 'center' }, homeTitle: { color: '#fff', fontSize: 28, fontWeight: '700', textAlign: 'center' }, actionCard: { backgroundColor: '#fff', marginHorizontal: 18, marginTop: 14, padding: 16, borderRadius: 18, elevation: 2 }, emergency: { borderWidth: 2, borderColor: blue }, actionTitle: { fontSize: 21, fontWeight: '700' }, gallery: { flexDirection: 'row', gap: 8, paddingHorizontal: 18 }, galleryCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 8, alignItems: 'center' }, galleryEmoji: { fontSize: 34, backgroundColor: '#AED9FF', width: '100%', textAlign: 'center', paddingVertical: 8, borderRadius: 8 }, nav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 64, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#AED9FF', flexDirection: 'row' }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' }, chatFloat: { position: 'absolute', right: 18, bottom: 78, backgroundColor: darkBlue, borderRadius: 28, width: 52, height: 52, alignItems: 'center', justifyContent: 'center', elevation: 4 }, chatHeader: { backgroundColor: blue, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }, avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: darkBlue }, chatTitle: { backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 22, paddingVertical: 8, fontSize: 28, fontWeight: '600' }, chatMessages: { flex: 1, padding: 20 }, assistant: { alignSelf: 'flex-start', backgroundColor: '#1E96FF', color: '#fff', borderRadius: 20, padding: 14, fontSize: 16, fontWeight: '700', maxWidth: '90%' }, userMessage: { alignSelf: 'flex-end', backgroundColor: paleBlue, color: '#12324B', borderRadius: 18, padding: 12, marginTop: 10, maxWidth: '90%' }, composer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#D5EAFF' }, messageInput: { flex: 1, borderWidth: 2, borderColor: '#AED9FF', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }, cameraButton: { backgroundColor: blue, borderRadius: 12, padding: 11 }, sendButton: { backgroundColor: darkBlue, borderRadius: 22, padding: 10 }, photoPreview: { width: '100%', height: 190, borderRadius: 16, marginBottom: 12 }, gameContent: { padding: 20, paddingBottom: 100 }, gameTitle: { fontSize: 30, fontWeight: '800', marginBottom: 18 }, option: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#AED9FF', borderRadius: 12, padding: 13, marginTop: 8 }, optionText: { color: '#12324B', fontWeight: '600' }, story: { backgroundColor: '#fff', padding: 16, borderRadius: 16 }, storyText: { fontSize: 17, fontWeight: '700', lineHeight: 24, marginVertical: 14 }, profile: { padding: 20, paddingBottom: 100 }, petPlaceholder: { alignItems: 'center', justifyContent: 'center', height: 150, borderRadius: 75, backgroundColor: paleBlue, marginVertical: 14 }, settingRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', padding: 16, borderRadius: 14, marginTop: 10 }, toggle: { color: darkBlue, fontWeight: '800' }, cameraScreen: { flex: 1, backgroundColor: '#000' }, cameraControls: { flex: 1, justifyContent: 'space-between', alignItems: 'center', padding: 20 }, cameraClose: { alignSelf: 'flex-start', backgroundColor: '#0008', borderRadius: 20, padding: 8 }, cameraCloseText: { color: '#fff', fontSize: 30 }, captureButton: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }, captureInner: { width: 66, height: 66, borderRadius: 33, backgroundColor: blue },
});
