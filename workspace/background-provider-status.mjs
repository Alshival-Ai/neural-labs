import { modelCredentialSource } from "./model-catalog.mjs";

// A saved profile is not proof of a working connection. Evaluate the native
// effective OAuth route, including expiry and provider failure state.
export function backgroundProviderStatus(authentication, models) {
  const provider = models?.auth?.oauth?.providers?.find(row => row.provider === "openai");
  const effective = provider?.effectiveProfiles;
  const usable = profile => profile?.type === "oauth" && ["ok", "expiring"].includes(profile.status)
    && authentication?.profiles?.some(saved => saved.id === profile.profileId && saved.provider === "openai" && saved.type === "oauth")
    && !models?.auth?.unusableProfiles?.some(row => row.profileId === profile.profileId);
  const authenticated = ["ok", "expiring"].includes(provider?.status)
    && Array.isArray(effective) && effective.length > 0 && effective.some(usable);
  const routesReady = Array.isArray(models?.auth?.missingProvidersInUse) && models.auth.missingProvidersInUse.length === 0
    && Array.isArray(models?.auth?.modelRouteIssues) && models.auth.modelRouteIssues.length === 0;
  const credentialSource = modelCredentialSource(authentication, models);
  return { credentialSource, authenticated, modelReady: routesReady && (authenticated || credentialSource === "environment-api-key") };
}
