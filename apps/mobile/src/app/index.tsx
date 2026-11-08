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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type ViewName = 'home' | 'report' | 'game' | 'chat' | 'profile' | 'settings';
type Role = 'owner' | 'shelter';
type StoryStep = 'situation' | 'animal' | 'story';
type ReportType = 'Injured pet' | 'Lost pet' | 'Found pet' | 'Animal in danger';

const blue = '#4099E6';
const darkBlue = '#0064BC';
const paleBlue = '#E8F5FF';
const ink = '#111111';
const situations = ['Hurricane / flooding', 'Tornado', 'Wildfires', 'Winter storms', 'Earthquakes'];
const animals = ['Dog', 'Cat', 'Snake', 'Bird', 'Rabbit'];
const reportTypes: ReportType[] = ['Injured pet', 'Lost pet', 'Found pet', 'Animal in danger'];

type SavedReport = { type: ReportType; notes: string; location: string; photoUri?: string };

export default function HomeScreen() {
  const [role, setRole] = useState<Role>();
  const [selectedRole, setSelectedRole] = useState<Role>();
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
  const [reportType, setReportType] = useState<ReportType>('Injured pet');
  const [reportNotes, setReportNotes] = useState('');
  const [reportLocation, setReportLocation] = useState('');
  const [reportPhoto, setReportPhoto] = useState<string>();
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);

  const openCamera = async (target: 'chat' | 'report' | 'profile' = 'chat') => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to scan a pet or injured animal.');
        return;
      }
    }
    setCameraTarget(target);
    setCameraOpen(true);
  };
  const [cameraTarget, setCameraTarget] = useState<'chat' | 'report' | 'profile'>('chat');
  const [profilePhoto, setProfilePhoto] = useState<string>();

  const capture = async () => {
    if (!camera) return;
    const photo = await camera.takePictureAsync({ quality: 0.8 });
    if (!photo?.uri) return;
    setCameraUri(photo.uri);
    if (cameraTarget === 'report') {
      setReportPhoto(photo.uri);
      setCameraOpen(false);
      setView('report');
    } else if (cameraTarget === 'profile') {
      setProfilePhoto(photo.uri);
      setCameraOpen(false);
      setView('profile');
    } else {
      setCameraOpen(false);
      setView('chat');
      setMessages((current) => [...current, 'Photo captured. Pawtricia can review this scan.']);
    }
  };

  const saveReport = () => {
    if (!reportNotes.trim() && !reportLocation.trim() && !reportPhoto) {
      Alert.alert('Add report details', 'Capture a photo or add notes or a location before saving.');
      return;
    }
    setSavedReports((current) => [...current, {
      type: reportType,
      notes: reportNotes.trim() || 'No notes added.',
      location: reportLocation.trim() || 'Location not provided.',
      photoUri: reportPhoto,
    }]);
    setReportNotes('');
    setReportLocation('');
    setReportPhoto(undefined);
    Alert.alert('Report saved', 'Your report is ready to send to responders.');
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
        <Text style={styles.authQuestion}>are you a</Text>
        <Pressable style={[styles.roleButton, selectedRole === 'shelter' && styles.roleSelected]} onPress={() => setSelectedRole('shelter')}>
          <Text style={styles.roleText}>Shelter Member</Text>
        </Pressable>
        <Text style={styles.orLabel}>or</Text>
        <Pressable style={[styles.roleButton, selectedRole === 'owner' && styles.roleSelected]} onPress={() => setSelectedRole('owner')}>
          <Text style={styles.roleText}>Pet Owner</Text>
        </Pressable>
        <Pressable disabled={!selectedRole} style={styles.nextButton} onPress={() => setRole(selectedRole)}>
          <Text style={[styles.nextText, !selectedRole && styles.disabledText]}>next →</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (role === 'shelter' && !shelterLoggedIn) {
    return (
      <SafeAreaView style={styles.shelterLogin}>
        <View style={styles.shelterCard}>
          <Text style={styles.shelterEyebrow}>PawSafe</Text>
          <Text style={styles.shelterTitle}>ShelterDash</Text>
          <Text style={styles.bodyText}>Sign in to coordinate care and help injured animals get home safely.</Text>
          <Text style={styles.label}>Password</Text>
          <TextInput value={shelterPassword} onChangeText={setShelterPassword} secureTextEntry placeholder="Enter your password" style={styles.input} />
          <Pressable style={styles.primaryButton} onPress={() => shelterPassword.trim() && setShelterLoggedIn(true)}>
            <Text style={styles.primaryButtonText}>Log in</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (role === 'shelter') {
    return <ShelterDashboard onSignOut={() => { setShelterLoggedIn(false); setRole(undefined); }} />;
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
      {view === 'report' && <Report type={reportType} setType={setReportType} notes={reportNotes} setNotes={setReportNotes} location={reportLocation} setLocation={setReportLocation} photoUri={reportPhoto} savedReports={savedReports} onBack={() => setView('home')} onCamera={() => openCamera('report')} onSave={saveReport} />}
      {view === 'game' && <Game step={storyStep} situation={situation} animal={animal} scene={scene} onSituation={(value) => { setSituation(value); setStoryStep('animal'); }} onAnimal={(value) => { setAnimal(value); setStoryStep('story'); }} onChoice={() => setScene((value) => Math.min(value + 1, 2))} onRestart={() => { setStoryStep('situation'); setSituation(''); setAnimal(''); setScene(0); }} />}
      {view === 'chat' && <Chat messages={messages} message={message} cameraUri={cameraUri} onMessage={setMessage} onSend={sendMessage} onCamera={() => openCamera('chat')} />}
      {view === 'profile' && <Profile photoUri={profilePhoto} onCamera={() => openCamera('profile')} />}
      {view === 'settings' && <Settings onSignOut={() => setRole(undefined)} />}
      <View style={styles.nav}>
        {([['home', 'home-outline'], ['game', 'game-controller-outline'], ['profile', 'paw-outline'], ['settings', 'settings-outline']] as const).map(([name, icon]) => (
          <Pressable key={name} onPress={() => setView(name)} style={styles.navItem}><Ionicons name={icon} size={25} color={view === name ? darkBlue : blue} /></Pressable>
        ))}
      </View>
      {view !== 'chat' && <Pressable style={styles.chatFloat} onPress={() => setView('chat')}><Ionicons name="chatbubble-ellipses-outline" size={23} color="#fff" /></Pressable>}
    </SafeAreaView>
  );
}

function Home({ onAction }: { onAction: (view: ViewName) => void }) {
  return <ScrollView style={styles.flex} contentContainerStyle={styles.homeContent}>
    <View style={styles.homeHeader}><Text style={styles.homeTitle}>We're here to help. ♡</Text></View>
    <Pressable style={styles.actionCard} onPress={() => onAction('report')}><Text style={styles.actionTitle}>Lost a pet</Text><Text style={styles.muted}>Tell us what happened and we'll help bring them home.</Text></Pressable>
    <Pressable style={styles.actionCard} onPress={() => onAction('report')}><Text style={styles.actionTitle}>Found a pet</Text><Text style={styles.muted}>Share where you found them to help reunite them with their family.</Text></Pressable>
    <Pressable style={[styles.actionCard, styles.emergency]} onPress={() => onAction('chat')}><Text style={styles.actionTitle}>Need help right now?</Text><Text style={styles.muted}>Get support for injured or endangered animals.</Text></Pressable>
    <View style={styles.homeTiles}>
      <Pressable style={styles.homeTile} onPress={() => onAction('report')}><Text style={styles.tileTitle}>Recent reports near you</Text><Text style={styles.tileText}>Similar pet matches</Text></Pressable>
      <Pressable style={styles.homeTile} onPress={() => onAction('game')}><Text style={styles.tileTitle}>Tips to stay</Text><Text style={styles.tileText}>Ready for emergencies</Text></Pressable>
    </View>
    <Text style={styles.sectionTitle}>Potential match found</Text>
    <View style={styles.gallery}>{[['🐶', 'Buddy', '85% similar'], ['🐕', 'Max', '78% similar'], ['🐩', 'Waffles', '72% similar']].map(([emoji, name, match]) => <Pressable style={styles.galleryCard} key={name}><Text style={styles.galleryEmoji}>{emoji}</Text><Text style={styles.cardTitle}>{name}</Text><Text style={styles.muted}>{match}</Text></Pressable>)}</View>
  </ScrollView>;
}

function Report({ type, setType, notes, setNotes, location, setLocation, photoUri, savedReports, onBack, onCamera, onSave }: { type: ReportType; setType: (value: ReportType) => void; notes: string; setNotes: (value: string) => void; location: string; setLocation: (value: string) => void; photoUri?: string; savedReports: SavedReport[]; onBack: () => void; onCamera: () => void; onSave: () => void }) {
  return <ScrollView style={styles.reportView} contentContainerStyle={styles.reportContent}>
    <View style={styles.reportHeader}><Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backText}>‹</Text></Pressable><View><Text style={styles.reportKicker}>New report</Text><Text style={styles.reportTitle}>Pet safety scan</Text></View></View>
    <View style={styles.reportPreview}>{photoUri ? <Image source={{ uri: photoUri }} style={styles.reportPhoto} contentFit="cover" /> : <MaterialCommunityIcons name="image-search-outline" size={42} color={darkBlue} />}<Text style={styles.reportPreviewTitle}>Capture the surroundings</Text><Text style={styles.reportPreviewText}>Include the pet, nearby hazards, and recognizable landmarks.</Text></View>
    <Pressable style={styles.cameraAction} onPress={onCamera}><Ionicons name="camera-outline" size={21} color="#fff" /><Text style={styles.primaryButtonText}>Open camera</Text></Pressable>
    <Text style={styles.formLabel}>What did you find?</Text>
    <View style={styles.typeOptions}>{reportTypes.map((item) => <Pressable key={item} onPress={() => setType(item)} style={[styles.typeOption, item === type && styles.typeSelected]}><Text style={[styles.typeText, item === type && styles.typeSelectedText]}>{item}</Text></Pressable>)}</View>
    <Text style={styles.formLabel}>Notes for responders</Text><TextInput value={notes} onChangeText={setNotes} multiline numberOfLines={2} placeholder="Describe the pet, injuries, or immediate hazards" style={styles.formInput} />
    <Text style={styles.formLabel}>Location or landmark</Text><TextInput value={location} onChangeText={setLocation} placeholder="Street, park, or nearby landmark" style={styles.formInput} />
    <View style={styles.reportActions}><Pressable style={styles.primaryButton} onPress={onSave}><Text style={styles.primaryButtonText}>Save report</Text></Pressable><Pressable disabled={!savedReports.length} style={[styles.sendReportButton, !savedReports.length && styles.disabledButton]} onPress={() => Alert.alert('Report sent', 'Responders have received your report.')}><Text style={styles.sendReportText}>Send to responders</Text></Pressable></View>
    <Text style={styles.savedTitle}>Saved reports</Text>
    {savedReports.length === 0 ? <Text style={styles.savedEmpty}>Your captured reports will appear here.</Text> : savedReports.map((report, index) => <View style={styles.savedReport} key={`${report.type}-${index}`}><Text style={styles.cardTitle}>{report.type}</Text><Text style={styles.muted}>{report.location}</Text><Text style={styles.savedNotes}>{report.notes}</Text></View>)}
  </ScrollView>;
}

function ShelterDashboard({ onSignOut }: { onSignOut: () => void }) {
  return <SafeAreaView style={styles.shelterScreen}><View style={styles.shelterTop}><View style={styles.shelterProfileIcon}><Text style={styles.shelterProfileText}>●</Text></View><Text style={styles.shelterTopText}>ShelterDash</Text></View><ScrollView contentContainerStyle={styles.shelterContent}>
    <View style={styles.reportCard}><View><Text style={styles.cardTitle}>New Reports</Text><Text style={styles.muted}>New animal reports need review.</Text></View><Text style={styles.reportCount}>+12</Text></View>
    <Text style={styles.sectionTitle}>Injured animals nearby</Text><View style={styles.map}><View style={styles.mapGrid} /><Text style={[styles.mapPin, { top: 35, left: '28%' }]}>🐾</Text><Text style={[styles.mapPin, { top: 100, left: '63%' }]}>🐾</Text><Text style={[styles.mapPin, { top: 65, left: '48%' }]}>🐾</Text><View style={styles.mapLabel}><Text style={styles.mapLabelText}>3 injured animals</Text><Text style={styles.mapLabelSmall}>within 5 miles</Text></View></View>
    <Text style={styles.sectionTitle}>Disaster Care</Text><CareRow icon="!" title="Active alerts" subtitle="View nearby emergencies" /><CareRow icon="+" title="Rescue resources" subtitle="Coordinate shelter support" />
    <Text style={styles.sectionTitle}>Potential Matches</Text><MatchRow initial="B" name="Buddy" match="85% match" /><MatchRow initial="W" name="Whiskers" match="92% match" />
    <Pressable style={styles.outlineButton} onPress={onSignOut}><Text style={styles.outlineButtonText}>Sign out</Text></Pressable>
  </ScrollView></SafeAreaView>;
}
function CareRow({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) { return <Pressable style={styles.careRow}><Text style={styles.careIcon}>{icon}</Text><View style={styles.careCopy}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>{subtitle}</Text></View><Text style={styles.careArrow}>→</Text></Pressable>; }
function MatchRow({ initial, name, match }: { initial: string; name: string; match: string }) { return <View style={styles.matchRow}><Text style={styles.matchAvatar}>{initial}</Text><View style={styles.careCopy}><Text style={styles.cardTitle}>{name}</Text><Text style={styles.muted}>{match}</Text></View><Text style={styles.matchBadge}>Potential</Text></View>; }

function Game({ step, situation, animal, scene, onSituation, onAnimal, onChoice, onRestart }: { step: StoryStep; situation: string; animal: string; scene: number; onSituation: (value: string) => void; onAnimal: (value: string) => void; onChoice: () => void; onRestart: () => void }) {
  const prompt = scene === 0 ? `A ${situation} is unfolding and you spot a ${animal}. What is your first move?` : `The ${animal} is safer, but help is still needed. What do you do next?`;
  return <ScrollView style={styles.gameView} contentContainerStyle={styles.gameContent}><View style={styles.gameHeader}><Text style={styles.gameKicker}>Safety story</Text><Text style={[styles.gameTitle, styles.gameHeaderTitle]}>Ready, pet hero?</Text></View>{step === 'situation' && <><Text style={styles.sectionTitle}>Choose a situation</Text>{situations.map((item) => <Option key={item} label={item} onPress={() => onSituation(item)} />)}</>}{step === 'animal' && <><Text style={styles.sectionTitle}>Who needs help?</Text>{animals.map((item) => <Option key={item} label={item} onPress={() => onAnimal(item)} />)}</>}{step === 'story' && <View style={styles.story}><Text style={styles.muted}>Scene {Math.min(scene + 1, 2)} of 2</Text><Text style={styles.storyText}>{scene >= 2 ? 'Great work! You kept yourself safe and connected the animal with help.' : prompt}</Text>{scene < 2 ? <><Option label="Move to safety and keep the animal calm" onPress={onChoice} /><Option label="Call for help and share the location" onPress={onChoice} /></> : <Pressable style={styles.primaryButton} onPress={onRestart}><Text style={styles.primaryButtonText}>Play another story</Text></Pressable>}</View>}</ScrollView>;
}
function Option({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable style={styles.option} onPress={onPress}><Text style={styles.optionText}>{label}</Text></Pressable>; }

function Chat({ messages, message, cameraUri, onMessage, onSend, onCamera }: { messages: string[]; message: string; cameraUri?: string; onMessage: (value: string) => void; onSend: () => void; onCamera: () => void }) {
  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><View style={styles.chatView}><View style={styles.chatHeader}><Image source={require('@/assets/doghead.png')} style={styles.avatar} /><Text style={styles.chatTitle}>Pawtricia</Text></View><ScrollView style={styles.chatMessages}>{!messages.length && <Text style={styles.assistant}>Hello! I am Pawtricia. How can I help you today?</Text>}{cameraUri && <Image source={{ uri: cameraUri }} style={styles.photoPreview} />}{messages.map((item, index) => <Text style={styles.userMessage} key={`${item}-${index}`}>{item}</Text>)}</ScrollView><View style={styles.composer}><TextInput value={message} onChangeText={onMessage} placeholder="Type a message..." style={styles.messageInput} /><Pressable style={styles.cameraButton} onPress={onCamera}><Ionicons name="camera-outline" size={23} color="#fff" /></Pressable><Pressable style={styles.sendButton} onPress={onSend}><Ionicons name="arrow-up" size={24} color="#fff" /></Pressable></View></View></KeyboardAvoidingView>;
}

function Profile({ photoUri, onCamera }: { photoUri?: string; onCamera: () => void }) {
  const [name, setName] = useState('');
  return <ScrollView style={styles.profileView} contentContainerStyle={styles.profile}><View style={styles.profileHero}><Text style={styles.profileKicker}>Tell us about your pet</Text><Pressable style={styles.petPlaceholder} onPress={onCamera}>{photoUri ? <Image source={{ uri: photoUri }} style={styles.profilePhoto} contentFit="cover" /> : <><MaterialCommunityIcons name="paw" size={50} color="#fff" /><Text style={styles.placeholderText}>Add photo</Text></>}</Pressable><Pressable style={styles.addPhoto} onPress={onCamera}><Text style={styles.addPhotoText}>+</Text></Pressable><Text style={styles.profileLabel}>Pet name</Text><TextInput value={name} onChangeText={setName} placeholder="e.g. Daisy" style={styles.petNameInput} /></View><View style={styles.profileDetails}><Text style={styles.formLabel}>More pet photos</Text><View style={styles.photoGrid}>{[1, 2, 3].map((slot) => <Pressable style={styles.photoSlot} key={slot}><Text style={styles.photoSlotText}>+</Text></Pressable>)}</View><TextInput placeholder="Age" keyboardType="number-pad" style={styles.formInput} /><TextInput placeholder="Identification features" multiline style={styles.formInput} /><TextInput placeholder="Any health conditions" multiline style={styles.formInput} /><Pressable style={styles.primaryButton}><Text style={styles.primaryButtonText}>Save pet profile</Text></Pressable></View></ScrollView>;
}

function Settings({ onSignOut }: { onSignOut: () => void }) {
  const [notifications, setNotifications] = useState(true);
  const [options, setOptions] = useState([true, true, true, true]);
  const labels = [['Emergency alerts', 'Severe weather and local disasters'], ['Missing pet alerts', 'New reports near your area'], ['Location/geofence alerts', 'When a pet enters or leaves a safe zone'], ['Urgent health concerns', 'Time-sensitive care reminders']];
  return <ScrollView style={styles.settingsView} contentContainerStyle={styles.settingsContent}><View style={styles.settingsHeader}><Text style={styles.settingsTitle}>Settings</Text><Text style={styles.settingsSubtitle}>Keep PawSafe working the way you need.</Text></View><View style={styles.settingsCard}><View style={styles.settingsHeading}><Ionicons name="notifications-outline" size={25} color={darkBlue} /><View style={styles.careCopy}><Text style={styles.cardTitle}>Push notifications</Text><Text style={styles.muted}>Choose what you want to hear about.</Text></View><Switch value={notifications} onValueChange={setNotifications} trackColor={{ true: blue }} /></View>{labels.map(([title, subtitle], index) => <View style={styles.notificationRow} key={title}><View style={styles.careCopy}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>{subtitle}</Text></View><Switch value={notifications && options[index]} onValueChange={(value) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))} trackColor={{ true: blue }} /></View>)}</View><SettingsCard title="Safety & privacy" rows={['Safe zones|Manage your location boundaries', 'Privacy controls|Choose what PawSafe can share']} /><SettingsCard title="Account" rows={['Help & support|Get answers or contact us']} /><Pressable style={styles.settingsDanger} onPress={onSignOut}><Text style={styles.cardTitle}>Sign out</Text><Text style={styles.muted}>Return to the welcome screen</Text></Pressable></ScrollView>;
}
function SettingsCard({ title, rows }: { title: string; rows: string[] }) { return <View style={styles.settingsCard}><Text style={styles.cardTitle}>{title}</Text>{rows.map((row) => { const [name, description] = row.split('|'); return <Pressable style={styles.settingsRow} key={name}><View style={styles.careCopy}><Text style={styles.cardTitle}>{name}</Text><Text style={styles.muted}>{description}</Text></View><Text style={styles.rowArrow}>›</Text></Pressable>; })}</View>; }

const styles = StyleSheet.create({
  flex: { flex: 1 }, app: { flex: 1, backgroundColor: '#F7FBFF' }, auth: { flex: 1, backgroundColor: blue, alignItems: 'center', justifyContent: 'center', padding: 18 }, logo: { width: 220, height: 160, marginBottom: 8 }, authTitle: { alignSelf: 'stretch', color: '#fff', fontSize: 64, fontWeight: '400', marginTop: 16 }, authQuestion: { color: '#fff', fontSize: 32, fontWeight: '800', marginVertical: 24 }, roleButton: { width: '100%', height: 60, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, roleSelected: { backgroundColor: '#DFF0FF', borderWidth: 4, borderColor: darkBlue }, roleText: { color: ink, fontSize: 25, fontWeight: '800' }, orLabel: { color: '#fff', fontSize: 30, fontWeight: '800', marginVertical: 10 }, nextButton: { alignSelf: 'flex-end', marginTop: 18 }, nextText: { color: '#fff', fontSize: 26, fontWeight: '800' }, disabledText: { color: '#B9DFFF' }, primaryButton: { backgroundColor: blue, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 12 }, primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' }, outlineButton: { borderWidth: 2, borderColor: blue, borderRadius: 14, padding: 12, alignItems: 'center', marginTop: 16 }, outlineButtonText: { color: blue, fontSize: 16, fontWeight: '700' }, shelterLogin: { flex: 1, backgroundColor: blue, justifyContent: 'center', padding: 20 }, shelterCard: { backgroundColor: '#fff', borderRadius: 25, padding: 24 }, shelterEyebrow: { color: blue, fontSize: 15, fontWeight: '800', marginBottom: 8 }, shelterTitle: { fontSize: 42, fontWeight: '400', marginBottom: 14 }, bodyText: { color: '#4A4A4A', fontSize: 16, lineHeight: 23 }, label: { fontWeight: '800', marginTop: 20, marginBottom: 6 }, input: { borderWidth: 2, borderColor: '#AED9FF', borderRadius: 12, padding: 14, backgroundColor: '#fff', minHeight: 48 }, shelterScreen: { flex: 1, backgroundColor: '#fff' }, shelterTop: { backgroundColor: blue, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }, shelterTopText: { color: '#fff', fontSize: 21, fontWeight: '700' }, shelterProfileIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, shelterProfileText: { color: blue, fontSize: 12 }, shelterContent: { padding: 20, paddingBottom: 50 }, reportCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 5, elevation: 2 }, cardTitle: { color: ink, fontSize: 16, fontWeight: '700' }, muted: { color: '#555', fontSize: 12, marginTop: 4 }, reportCount: { color: blue, backgroundColor: '#AED9FF', padding: 7, borderRadius: 8, fontWeight: '800' }, sectionTitle: { color: ink, fontSize: 21, fontWeight: '700', marginTop: 20, marginBottom: 10 }, map: { height: 205, borderWidth: 3, borderColor: '#AED9FF', borderRadius: 18, backgroundColor: '#D7EDDB', overflow: 'hidden', position: 'relative' },   mapGrid: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.5, backgroundColor: '#C4E4C9' }, mapPin: { position: 'absolute', width: 36, height: 36, textAlign: 'center', paddingTop: 6, borderRadius: 20, backgroundColor: blue, borderWidth: 3, borderColor: '#fff', overflow: 'hidden' }, mapLabel: { position: 'absolute', right: 10, bottom: 10, backgroundColor: '#fff', padding: 7, borderRadius: 10 }, mapLabelText: { fontWeight: '800', fontSize: 12 }, mapLabelSmall: { color: '#555', fontSize: 11 }, careRow: { backgroundColor: '#F7FBFF', borderRadius: 16, padding: 10, flexDirection: 'row', alignItems: 'center', marginBottom: 9 }, careIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#AED9FF', color: darkBlue, fontSize: 22, fontWeight: '900', textAlign: 'center', paddingTop: 7 }, careCopy: { flex: 1, marginLeft: 10 }, careArrow: { color: blue, fontSize: 22 }, matchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }, matchAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#AED9FF', color: darkBlue, textAlign: 'center', paddingTop: 11, fontWeight: '900' }, matchBadge: { color: darkBlue, backgroundColor: '#AED9FF', borderRadius: 8, padding: 6, fontSize: 11 }, homeContent: { paddingBottom: 100 }, homeHeader: { backgroundColor: blue, padding: 30, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, alignItems: 'center' }, homeTitle: { color: '#fff', fontSize: 30, textAlign: 'center' }, actionCard: { backgroundColor: '#fff', marginHorizontal: 20, marginTop: 12, padding: 16, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 5, elevation: 2 }, emergency: { borderWidth: 2, borderColor: blue }, actionTitle: { color: ink, fontSize: 24, marginBottom: 4 }, homeTiles: { flexDirection: 'row', gap: 12, marginHorizontal: 20, marginTop: 12 }, homeTile: { flex: 1, minHeight: 84, backgroundColor: paleBlue, borderRadius: 20, padding: 12, alignItems: 'center', justifyContent: 'center' }, tileTitle: { color: ink, fontSize: 17, textAlign: 'center' }, tileText: { color: '#526B82', fontSize: 11, marginTop: 4 }, gallery: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 }, galleryCard: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 8, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 }, galleryEmoji: { fontSize: 29, backgroundColor: '#AED9FF', width: '100%', textAlign: 'center', paddingVertical: 10, borderRadius: 10 }, nav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 64, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#AED9FF', flexDirection: 'row' }, navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' }, chatFloat: { position: 'absolute', right: 18, bottom: 78, backgroundColor: darkBlue, borderRadius: 28, width: 52, height: 52, alignItems: 'center', justifyContent: 'center', elevation: 4 }, reportView: { flex: 1, backgroundColor: '#F7FBFF' }, reportContent: { paddingBottom: 90 }, reportHeader: { backgroundColor: blue, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 10 }, backButton: { width: 34 }, backText: { color: '#fff', fontSize: 42, lineHeight: 40 }, reportKicker: { color: '#fff', fontSize: 12, fontWeight: '800' }, reportTitle: { color: '#fff', fontSize: 28, fontWeight: '400', marginTop: 4 }, reportPreview: { margin: 20, minHeight: 180, borderRadius: 18, backgroundColor: '#DFF0FF', alignItems: 'center', justifyContent: 'center', padding: 18 }, reportPhoto: { width: '100%', height: 150, borderRadius: 12, marginBottom: 10 }, reportPreviewTitle: { color: darkBlue, fontSize: 16, fontWeight: '700', marginTop: 8 }, reportPreviewText: { color: '#526B82', fontSize: 12, textAlign: 'center', marginTop: 5 }, cameraAction: { marginHorizontal: 20, backgroundColor: darkBlue, borderRadius: 14, padding: 13, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }, formLabel: { color: ink, fontSize: 12, fontWeight: '800', marginHorizontal: 20, marginTop: 16, marginBottom: 6 }, formInput: { marginHorizontal: 20, borderWidth: 1, borderColor: '#B8DAFA', borderRadius: 10, backgroundColor: '#fff', padding: 10, minHeight: 44, color: ink }, typeOptions: { marginHorizontal: 20, gap: 7 }, typeOption: { borderWidth: 1, borderColor: '#B8DAFA', borderRadius: 10, backgroundColor: '#fff', padding: 11 }, typeSelected: { backgroundColor: paleBlue, borderColor: darkBlue }, typeText: { color: '#12324B' }, typeSelectedText: { color: darkBlue, fontWeight: '700' }, savedTitle: { color: ink, fontSize: 21, fontWeight: '700', marginHorizontal: 20, marginTop: 24 }, savedEmpty: { color: '#667', marginHorizontal: 20, marginTop: 8 }, savedReport: { marginHorizontal: 20, marginTop: 9, padding: 13, borderRadius: 14, backgroundColor: '#fff' }, savedNotes: { color: '#333', marginTop: 7 },   gameView: { flex: 1, backgroundColor: '#F7FBFF' }, gameContent: { paddingBottom: 100 }, gameHeader: { backgroundColor: blue, padding: 24 }, gameKicker: { color: '#fff', fontSize: 12, fontWeight: '800' }, gameTitle: { color: ink, fontSize: 30, fontWeight: '800', marginTop: 4, marginBottom: 18 }, gameHeaderTitle: { color: '#fff' }, option: { marginHorizontal: 20, marginTop: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#AED9FF', borderRadius: 12, padding: 13 }, optionText: { color: '#12324B', fontWeight: '600' }, story: { margin: 20, padding: 16, backgroundColor: '#fff', borderRadius: 16 }, storyText: { color: ink, fontSize: 17, fontWeight: '700', lineHeight: 24, marginVertical: 14 }, reportActions: { marginHorizontal: 20, gap: 8 }, sendReportButton: { borderWidth: 1, borderColor: blue, borderRadius: 14, padding: 13, alignItems: 'center' }, sendReportText: { color: darkBlue, fontWeight: '700' }, disabledButton: { opacity: 0.45 }, chatView: { flex: 1, backgroundColor: blue }, chatHeader: { padding: 31, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: darkBlue }, chatTitle: { backgroundColor: '#fff', borderRadius: 25, paddingHorizontal: 22, paddingVertical: 8, color: ink, fontSize: 32 }, chatMessages: { flex: 1, marginHorizontal: 20, padding: 20, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: '#fff' }, assistant: { alignSelf: 'flex-start', backgroundColor: '#1E96FF', color: '#fff', borderRadius: 20, padding: 14, fontSize: 16, fontWeight: '700', maxWidth: '90%' }, userMessage: { alignSelf: 'flex-end', backgroundColor: paleBlue, color: '#12324B', borderRadius: 18, padding: 12, marginTop: 10, maxWidth: '90%' }, composer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, marginHorizontal: 20, backgroundColor: '#fff' }, messageInput: { flex: 1, borderWidth: 2, borderColor: '#AED9FF', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }, cameraButton: { backgroundColor: blue, borderRadius: 12, padding: 11 }, sendButton: { backgroundColor: darkBlue, borderRadius: 22, padding: 10 }, photoPreview: { width: '100%', height: 190, borderRadius: 16, marginBottom: 12 }, profileView: { flex: 1, backgroundColor: '#F7FBFF' }, profile: { paddingBottom: 90 }, profileHero: { backgroundColor: blue, padding: 14, minHeight: 304, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }, profileKicker: { color: '#fff', fontSize: 18, fontWeight: '800' }, petPlaceholder: { alignSelf: 'center', width: 138, height: 138, borderRadius: 69, borderWidth: 3, borderColor: '#fff', borderStyle: 'dashed', backgroundColor: '#ffffff2e', alignItems: 'center', justifyContent: 'center', marginTop: 8, overflow: 'hidden' }, profilePhoto: { width: '100%', height: '100%' }, placeholderText: { color: '#fff', fontWeight: '800' }, addPhoto: { position: 'absolute', top: 138, right: '26%', width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, addPhotoText: { color: blue, fontSize: 26 }, profileLabel: { color: '#fff', fontSize: 12, fontWeight: '800', marginTop: 9 }, petNameInput: { marginTop: 4, borderWidth: 2, borderColor: '#ffffffbf', borderRadius: 10, backgroundColor: '#fff', padding: 8, fontSize: 16 }, profileDetails: { padding: 10, gap: 4 }, photoGrid: { flexDirection: 'row', gap: 7, marginHorizontal: 20 }, photoSlot: { flex: 1, height: 48, borderWidth: 1, borderColor: blue, borderStyle: 'dashed', borderRadius: 9, backgroundColor: '#E7F3FF', alignItems: 'center', justifyContent: 'center' }, photoSlotText: { color: darkBlue, fontSize: 22 }, settingsView: { flex: 1, backgroundColor: '#F7FBFF' }, settingsContent: { paddingBottom: 90 }, settingsHeader: { backgroundColor: blue, padding: 24 }, settingsTitle: { color: '#fff', fontSize: 30, fontWeight: '800' }, settingsSubtitle: { color: '#fff', marginTop: 5 }, settingsCard: { margin: 14, padding: 16, borderRadius: 16, backgroundColor: '#fff' }, settingsHeading: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8 }, notificationRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#EEF4F8' }, settingsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }, rowArrow: { color: blue, fontSize: 25 }, settingsDanger: { margin: 14, padding: 16, borderRadius: 16, backgroundColor: '#FFF0F0' }, cameraScreen: { flex: 1, backgroundColor: '#000' }, cameraControls: { flex: 1, justifyContent: 'space-between', alignItems: 'center', padding: 20 }, cameraClose: { alignSelf: 'flex-start', backgroundColor: '#0008', borderRadius: 20, padding: 8 }, cameraCloseText: { color: '#fff', fontSize: 30 }, captureButton: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }, captureInner: { width: 66, height: 66, borderRadius: 33, backgroundColor: blue },
});
