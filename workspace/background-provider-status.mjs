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

// Supported Gateway APIs avoid spawning the CLI (and its separate local status
// handshake). This check belongs only to the background owner, main.
export function backgroundGatewayStatus(authentication, catalog) {
  const provider = authentication?.providers?.find(row => row.provider === "openai");
  const authenticated = !authentication?.unavailable && ["ok", "expiring"].includes(provider?.status)
    && provider.profiles?.some(row => row.profileId === "openai:neural-labs-background"
      && row.type === "oauth" && ["ok", "expiring"].includes(row.status)) === true;
  const modelReady = !authentication?.unavailable && ["ok", "expiring"].includes(provider?.status)
    && catalog?.models?.some(row => row.provider === "openai" && row.available === true) === true;
  return { authenticated, modelReady,
    credentialSource: authenticated ? "chatgpt" : provider?.profiles?.length ? "stored-credential" : modelReady ? "environment-api-key" : "unconfigured", checking: false };
}
