import type { ControlPlaneConfig } from "./config.js";
import { CredentialCipher } from "./crypto.js";
import type { Database } from "./database.js";
import type {
  EffectiveEntraConfig,
  ProviderAvailability,
  StoredInstanceConfig,
} from "./types.js";

export class AuthConfigurationService {
  constructor(
    private readonly database: Database,
    private readonly runtime: ControlPlaneConfig,
    private readonly cipher: CredentialCipher,
  ) {}

  async getStored(): Promise<StoredInstanceConfig> {
    return this.database.getInstanceConfig();
  }

  effectivePublicOrigin(stored: StoredInstanceConfig): URL | undefined {
    const value = stored.publicOrigin ?? this.runtime.publicOrigin?.toString();
    return value ? new URL(value) : undefined;
  }

  effectiveEntra(stored: StoredInstanceConfig): EffectiveEntraConfig | undefined {
    if (
      stored.entraTenantId &&
      stored.entraClientId &&
      stored.encryptedEntraCredential
    ) {
      return {
        source: "onboarding",
        tenantId: stored.entraTenantId,
        clientId: stored.entraClientId,
        authorityHost: stored.entraAuthorityHost,
        credential: this.cipher.decrypt(stored.encryptedEntraCredential),
      };
    }
    return this.runtime.environmentEntra;
  }

  async providers(): Promise<ProviderAvailability> {
    const stored = await this.getStored();
    const entra = this.effectiveEntra(stored);
    return {
      setupComplete: stored.setupComplete,
      local: { available: true, enabled: stored.setupComplete && stored.localAuthEnabled },
      microsoft: {
        available: Boolean(entra),
        enabled: stored.setupComplete && stored.microsoftAuthEnabled && Boolean(entra),
        ...(entra ? { source: entra.source } : {}),
      },
    };
  }
}
