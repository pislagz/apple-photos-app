import { mutate, request } from "./api";
import type { AuthUserResponse } from "./api";

// P3.1: WebAuthn through the browser's own navigator.credentials, no helper
// library. The server speaks base64url JSON; the browser wants ArrayBuffers.

export interface Passkey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

interface OptionsResponse {
  challenge_id: string;
  options: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext !== false &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator !== "undefined" &&
    !!navigator.credentials
  );
}

export function b64urlToBuffer(text: string): ArrayBuffer {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToB64url(buffer: ArrayBuffer | null | undefined): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Descriptor = { id: string; type: "public-key"; transports?: AuthenticatorTransport[] };

function descriptors(list: Descriptor[] | undefined): PublicKeyCredentialDescriptor[] | undefined {
  return list?.map((item) => ({ ...item, id: b64urlToBuffer(item.id) }));
}

// Exported for tests: the JSON the server sends -> what navigator.credentials wants.
export function creationOptionsFromJSON(options: OptionsResponse["options"]): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: b64urlToBuffer(options.challenge),
    user: { ...options.user, id: b64urlToBuffer(options.user.id) },
    excludeCredentials: descriptors(options.excludeCredentials),
  } as PublicKeyCredentialCreationOptions;
}

export function requestOptionsFromJSON(options: OptionsResponse["options"]): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: b64urlToBuffer(options.challenge),
    allowCredentials: descriptors(options.allowCredentials),
  } as PublicKeyCredentialRequestOptions;
}

export function registrationToJSON(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: bufferToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToB64url(response.clientDataJSON),
      attestationObject: bufferToB64url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

export function assertionToJSON(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bufferToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToB64url(response.clientDataJSON),
      authenticatorData: bufferToB64url(response.authenticatorData),
      signature: bufferToB64url(response.signature),
      userHandle: response.userHandle ? bufferToB64url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

export function listPasskeys(): Promise<Passkey[]> {
  return request<Passkey[]>("/api/auth/passkeys");
}

export function removePasskey(id: string): Promise<void> {
  return mutate<void>("DELETE", `/api/auth/passkeys/${encodeURIComponent(id)}`);
}

// Signed-in: create a passkey for the current user.
// The account password is re-checked by the server before it issues the
// challenge, so a left-open session cannot plant a passkey (D43).
export async function registerPasskey(name: string, password: string): Promise<Passkey> {
  const begun = await mutate<OptionsResponse>("POST", "/api/auth/passkeys/register/options", { password });
  const credential = (await navigator.credentials.create({
    publicKey: creationOptionsFromJSON(begun.options),
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey was created.");
  return mutate<Passkey>("POST", "/api/auth/passkeys/register/verify", {
    challenge_id: begun.challenge_id,
    credential: registrationToJSON(credential),
    name,
  });
}

// Anonymous: sign in with whichever passkey the browser offers. The session
// cookie is set by the server exactly like the password login.
export async function loginWithPasskey(
  rememberMe = false,
  client: "desktop" | "pwa" = "desktop",
): Promise<AuthUserResponse> {
  const begun = await mutate<OptionsResponse>("POST", "/api/auth/passkeys/login/options", {});
  const credential = (await navigator.credentials.get({
    publicKey: requestOptionsFromJSON(begun.options),
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey was used.");
  return mutate<AuthUserResponse>("POST", "/api/auth/passkeys/login/verify", {
    challenge_id: begun.challenge_id,
    credential: assertionToJSON(credential),
    remember_me: rememberMe,
    client,
  });
}

// The user closing the browser's passkey sheet is not an error worth showing.
export function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
}
