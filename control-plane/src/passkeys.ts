import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

import type { PasskeyRecord, UserRecord } from "./types.js";

export type PasskeyRegistrationResult = {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[];
};

export type PasskeyAuthenticationResult = {
  newCounter: number;
  backedUp: boolean;
};

export interface WebAuthnOperations {
  registrationOptions(
    origin: URL,
    user: UserRecord,
    existing: PasskeyRecord[],
  ): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; webauthnUserId: string }>;
  verifyRegistration(
    origin: URL,
    response: RegistrationResponseJSON,
    expectedChallenge: string,
  ): Promise<PasskeyRegistrationResult | undefined>;
  authenticationOptions(origin: URL): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthentication(
    origin: URL,
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    passkey: PasskeyRecord,
  ): Promise<PasskeyAuthenticationResult | undefined>;
}

function rpID(origin: URL): string {
  return origin.hostname;
}

export class WebAuthnService implements WebAuthnOperations {
  async registrationOptions(origin: URL, user: UserRecord, existing: PasskeyRecord[]) {
    const userID = new TextEncoder().encode(user.id);
    const options = await generateRegistrationOptions({
      rpName: "Neural Labs",
      rpID: rpID(origin),
      userID,
      userName: user.email,
      userDisplayName: user.displayName,
      attestationType: "none",
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports,
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      timeout: 5 * 60 * 1000,
    });
    return { options, webauthnUserId: options.user.id };
  }

  async verifyRegistration(origin: URL, response: RegistrationResponseJSON, expectedChallenge: string) {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin.origin,
      expectedRPID: rpID(origin),
      requireUserPresence: true,
      requireUserVerification: true,
    });
    if (!verification.verified) return undefined;
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports ?? [],
    };
  }

  authenticationOptions(origin: URL) {
    return generateAuthenticationOptions({
      rpID: rpID(origin),
      allowCredentials: [],
      userVerification: "required",
      timeout: 5 * 60 * 1000,
    });
  }

  async verifyAuthentication(
    origin: URL,
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    passkey: PasskeyRecord,
  ) {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin.origin,
      expectedRPID: rpID(origin),
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array([...passkey.publicKey]),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
    if (!verification.verified) return undefined;
    return {
      newCounter: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
    };
  }
}
