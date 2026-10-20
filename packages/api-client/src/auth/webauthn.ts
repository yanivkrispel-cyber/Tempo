/**
 * The JSON forms of WebAuthn options and credentials that Cognito sends and expects (`CREDENTIAL_REQUEST_OPTIONS`,
 * `CredentialCreationOptions`, `AuthenticationResponseJSON`, `RegistrationResponseJSON`), converted by hand because
 * `PublicKeyCredential.parseRequestOptionsFromJSON` is not in every browser the members app supports.
 */

type Json = Record<string, unknown>;

export function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return bytes.buffer;
}

export function toBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function descriptors(list: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return (list as Json[]).map((item) => ({
    type: "public-key",
    id: fromBase64Url(String(item.id)),
    ...(Array.isArray(item.transports) ? { transports: item.transports as AuthenticatorTransport[] } : {}),
  }));
}

export function requestOptionsFromJson(json: Json): PublicKeyCredentialRequestOptions {
  return {
    ...(json as unknown as PublicKeyCredentialRequestOptions),
    challenge: fromBase64Url(String(json.challenge)),
    allowCredentials: descriptors(json.allowCredentials),
  };
}

export function creationOptionsFromJson(json: Json): PublicKeyCredentialCreationOptions {
  const user = json.user as Json;
  return {
    ...(json as unknown as PublicKeyCredentialCreationOptions),
    challenge: fromBase64Url(String(json.challenge)),
    user: { ...(user as unknown as PublicKeyCredentialUserEntity), id: fromBase64Url(String(user.id)) },
    excludeCredentials: descriptors(json.excludeCredentials),
  };
}

export function assertionToJson(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : undefined,
    },
  };
}

export function attestationToJson(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : undefined,
    },
  };
}
