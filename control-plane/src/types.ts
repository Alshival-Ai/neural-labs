export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "active" | "rejected" | "disabled";
export type IdentityProvider = "local" | "microsoft";

export interface UserRecord {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdentityRecord {
  id: string;
  userId: string;
  provider: IdentityProvider;
  subject: string;
  tenantId?: string;
  username?: string;
  passwordHash?: string;
  createdAt: Date;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  csrfHash: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface SessionActor {
  user: UserRecord;
  session: SessionRecord;
  identities: IdentityRecord[];
}

export type EntraCredential =
  | { type: "secret"; clientSecret: string }
  | {
      type: "certificate";
      certificatePem: string;
      privateKeyPem: string;
      thumbprint: string;
      expiresAt: string;
    };

export interface StoredInstanceConfig {
  setupComplete: boolean;
  publicOrigin?: string;
  localAuthEnabled: boolean;
  microsoftAuthEnabled: boolean;
  microsoftMcpEnabled: boolean;
  entraTenantId?: string;
  entraClientId?: string;
  entraAuthorityHost: string;
  encryptedEntraCredential?: string;
  configVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EffectiveEntraConfig {
  source: "onboarding" | "environment";
  tenantId: string;
  clientId: string;
  authorityHost: string;
  credential: EntraCredential;
}

export interface ProviderAvailability {
  setupComplete: boolean;
  local: { available: true; enabled: boolean };
  passkey: { available: true; enabled: boolean };
  microsoft: {
    available: boolean;
    enabled: boolean;
    source?: "onboarding" | "environment";
  };
}

export interface MicrosoftClaims {
  subject: string;
  tenantId: string;
  objectId?: string;
  email: string;
  displayName: string;
  username?: string;
}

export interface OidcTransaction {
  stateHash: string;
  nonce: string;
  codeVerifier: string;
  intent: "login" | "link";
  sessionUserId?: string;
  expiresAt: Date;
}

export interface PasskeyRecord {
  id: string;
  userId: string;
  credentialId: string;
  webauthnUserId: string;
  publicKey: Uint8Array;
  counter: number;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[];
  displayName: string;
  createdAt: Date;
  lastUsedAt?: Date;
}

export interface PasskeyChallenge {
  tokenHash: string;
  challenge: string;
  kind: "registration" | "authentication";
  userId?: string;
  expiresAt: Date;
}

export interface McpRuntimeConfig {
  version: number;
  tenantId: string;
  clientId: string;
  authorityHost: string;
  publicUrl: string;
  oauthScope: string;
  requiredScope: string;
  tokenAudience: string;
}
