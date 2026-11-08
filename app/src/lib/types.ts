export type Role = 'owner' | 'shelter';
export type Species = 'dog' | 'cat' | 'other';
export type Hazard = 'tornado' | 'flood' | 'wildfire' | 'heat';
export type Angle = 'front' | 'left' | 'right' | 'marking' | 'other';

export type Profile = {
  id: string;
  name: string;
  generalLocation: string;
  contactPreferences: string;
  emergencyContact: string;
};

export type Pet = {
  id: string;
  ownerId: string;
  name: string;
  species: Species;
  breed: string;
  colors: string[];
  markings: string;
  age: string;
  size: string;
  microchip: string;
};

export type Photo = {
  id: string;
  ownerId: string;
  storageKey: string;
  angle: Angle;
  animalCount: number;
  embeddingRef: string;
  petId?: string;
  reportId?: string;
};

export type Report = {
  id: string;
  creatorId: string;
  petId: string;
  type: 'lost' | 'found';
  status: 'open' | 'closed' | 'reunited';
  species: Species;
  breed: string;
  colors: string[];
  latitude: number;
  longitude: number;
  observedAt: string;
  generalLocation: string;
  description: string;
  condition: string;
  createdAt: string;
  updatedAt: string;
};

export type ReportSummary = {
  id: string;
  type: 'lost' | 'found';
  species: Species;
  latitude: number;
  longitude: number;
  observedAt: string;
  status: string;
};

export type Shelter = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string;
  website: string;
  directorySources: string[];
  directoryConfidence: string;
  operatorVerified: boolean;
  totalCapacity?: number;
  currentOccupancy?: number;
  acceptingAnimals?: boolean;
  capacityUpdatedAt: string;
};

export type NearbyShelter = Partial<Shelter> &
  Pick<Shelter, 'id' | 'name' | 'latitude' | 'longitude'> & { distanceKm: number };

export type SourceStatus = { source: string; status: 'ok' | 'unavailable'; detail?: string };
export type Sourced<T> = { items: T[]; sources: SourceStatus[] };

export type ExternalReport = {
  id: string;
  source: 'bluesky' | 'shelterluv' | 'dallas';
  sourceUrl: string;
  reportType: 'lost' | 'found' | 'shelter_listing' | 'unknown';
  species?: Species;
  breed?: string;
  colors?: string[];
  locationLabel?: string;
  photoUrls: string[];
  postedAt?: string;
  processingAllowed: boolean;
};

export type Verification = 'unverified' | 'pending_review' | 'verified' | 'rejected';

export type StaffAccess = {
  shelterId: string;
  role: 'manager' | 'staff';
  shelter: Shelter | null;
  verification: Verification;
};

export type Application = { shelterId: string; status: Verification; reviewedAt: string; shelter: Shelter | null };

export type Access = {
  identity: string;
  role: '' | 'admin' | 'reviewer' | 'service';
  staff: StaffAccess[];
  applications: Application[];
};

export type StaffMember = { userId: string; role: 'manager' | 'staff'; name: string };

export type VerificationRequest = {
  id: string;
  applicantId: string;
  status: Verification;
  evidence: string;
  reviewedAt: string;
  reviewerId: string;
};

export type CaseStatus = 'open' | 'under_review' | 'assigned' | 'in_progress' | 'resolved' | 'cancelled';
export type Priority = 'critical' | 'urgent' | 'normal';

export type RescueCase = {
  id: string;
  reportId: string;
  creatorId: string;
  shelterId: string;
  assigneeId: string;
  priority: Priority;
  reason: string;
  status: CaseStatus;
  updatedAt: string;
  outcome: string;
};

export type CaseDetail = RescueCase & {
  summary: ReportSummary | null;
  report: Report | null;
  photos: Photo[];
};

export type QueuedCase = { id: string; priority: Priority; report: ReportSummary | null };

export type MatchEvidence = {
  candidatePhotoId?: string;
  matchingPhotoId?: string;
  visualSimilarity?: number;
  components?: Record<string, unknown>;
  model?: string;
  sourceUrl?: string;
  candidatePhotoUrl?: string;
  reviewRequired?: boolean;
};

export type Match = {
  id: string;
  lostReportId: string;
  ownerId: string;
  finderId: string;
  candidateId: string;
  candidateType: 'report' | 'external';
  score: number;
  evidence: MatchEvidence;
  status: 'pending' | 'confirmed' | 'rejected';
  updatedAt: string;
};

export type NotificationType =
  | 'POSSIBLE_PET_MATCH'
  | 'MATCH_CONFIRMED'
  | 'NEW_NEARBY_REPORT'
  | 'SHELTER_CASE_ASSIGNED'
  | 'SHELTER_CAPACITY_CHANGED'
  | 'REPORT_STATUS_CHANGED'
  | 'DISASTER_ALERT';

export type AppNotification = {
  id: string;
  recipientId: string;
  eventType: NotificationType;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string;
};

export type WeatherAlert = {
  source: 'NWS';
  alertId: string;
  sourceUrl: string;
  event: string;
  severity: string;
  urgency: string;
  headline: string;
  description: string;
  instruction?: string;
  effectiveAt: string;
  expiresAt?: string;
};

export type DisasterRecord = {
  id?: string;
  disasterNumber: number;
  sourceUrl: string;
  title?: string;
  incidentType?: string;
  area?: string;
  declarationDate?: string;
};

export type Guidance = { hazard: Hazard; items: string[]; sourceUrls: string[] };

export type ScenarioSummary = { id: Hazard; title: string };

export type SimulationState = {
  id: string;
  revision: number;
  scenarioId: Hazard;
  title: string;
  source: string;
  completed: boolean;
  history: { label: string; feedback: string }[];
  scene?: { id: string; title: string; choices: { id: string; label: string }[] };
  metrics: { petSafety: number; preparedness: number; decisionQuality: number };
  score: number;
};

export type PendingAction = {
  operation: 'create_lost_report' | 'create_found_report';
  payload: Record<string, unknown>;
};

export type AgentAction = { tool: string; status: string; resourceId?: string; result?: unknown };

export type AgentResult = {
  runId: string;
  previousRunId?: string;
  status: 'running' | 'completed' | 'failed' | 'awaiting_confirmation';
  summary: string;
  actions: AgentAction[];
  pendingAction?: PendingAction;
  possibleMatchIds: string[];
};

export type UploadedPhoto = { id: string; storageKey: string; animalCount?: number };
