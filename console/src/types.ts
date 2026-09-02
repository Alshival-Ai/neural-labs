export type UserRole = "admin" | "user";
export type UserStatus = "pending" | "active" | "rejected" | "disabled";
export type IdentityProvider = "local" | "microsoft";

export interface PublicUser {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export type SessionResponse =
  | { authenticated: false }
  | {
      authenticated: true;
      user: PublicUser;
      providers: IdentityProvider[];
      csrfToken: string;
    };

export interface ProviderAvailability {
  setupComplete: boolean;
  local: { available: true; enabled: boolean };
  microsoft: {
    available: boolean;
    enabled: boolean;
    source?: "onboarding" | "environment";
  };
}

export interface WorkspaceStatus {
  available: boolean;
  shared: true;
  persistent: true;
  status: "ready" | "starting" | "offline";
  publicUrl: string | null;
  openclawVersion: string;
  codexVersion: string;
  codexAuthenticated: boolean;
  openclawModelReady: boolean;
}

export interface ApiErrorPayload {
  error?: { code?: string; message?: string };
}
