import {
  X509Certificate,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import argon2 from "argon2";

import type { EntraCredential } from "./types.js";

interface CipherEnvelope {
  v: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class CredentialCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Credential encryption key must be 32 bytes");
  }

  encrypt(value: EntraCredential): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: CipherEnvelope = {
      v: 1,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
    return JSON.stringify(envelope);
  }

  decrypt(value: string): EntraCredential {
    const envelope = JSON.parse(value) as Partial<CipherEnvelope>;
    if (envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.ciphertext) {
      throw new Error("Unsupported credential envelope");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(envelope.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as EntraCredential;
  }
}

function extractPemBlock(value: string, labelPattern: string): string | undefined {
  const match = new RegExp(
    `-----BEGIN (${labelPattern})-----[\\s\\S]+?-----END \\1-----`,
  ).exec(value);
  return match?.[0]?.trim();
}

export function normalizeCertificateCredential(
  pemBundle: string,
  passphrase?: string,
): Extract<EntraCredential, { type: "certificate" }> {
  const certificatePem = extractPemBlock(pemBundle, "CERTIFICATE");
  const privateKeyPem = extractPemBlock(
    pemBundle,
    "(?:RSA |EC |ENCRYPTED )?PRIVATE KEY",
  );
  if (!certificatePem || !privateKeyPem) {
    throw new Error("PEM upload must contain both a certificate and private key");
  }

  const certificate = new X509Certificate(certificatePem);
  const privateKey = createPrivateKey({
    key: privateKeyPem,
    format: "pem",
    ...(passphrase ? { passphrase } : {}),
  });
  const certificatePublicKey = certificate.publicKey.export({ type: "spki", format: "der" });
  const privatePublicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  if (
    certificatePublicKey.length !== privatePublicKey.length ||
    !timingSafeEqual(certificatePublicKey, privatePublicKey)
  ) {
    throw new Error("Certificate and private key do not match");
  }

  const expiresAt = new Date(certificate.validTo);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw new Error("Certificate is expired or has an invalid expiration date");
  }

  const normalizedPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    type: "certificate",
    certificatePem: `${certificatePem}\n`,
    privateKeyPem: normalizedPrivateKey,
    thumbprint: certificate.fingerprint256.replaceAll(":", "").toLowerCase(),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
