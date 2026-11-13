import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFetch, jsonResponse } from "./testHelpers";
import {
  b64urlToBuffer,
  bufferToB64url,
  creationOptionsFromJSON,
  loginWithPasskey,
  passkeyConnectionNote,
  passkeysSupported,
  registerPasskey,
  requestOptionsFromJSON,
} from "./passkeys";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("base64url", () => {
  it("round-trips bytes without padding or + and /", () => {
    const bytes = Uint8Array.from([251, 255, 254, 0, 1]);
    const text = bufferToB64url(bytes.buffer);
    expect(text).toBe("-__-AAE");
    expect(Array.from(new Uint8Array(b64urlToBuffer(text)))).toEqual(Array.from(bytes));
  });
});

describe("options conversion", () => {
  it("turns the server's strings into buffers", () => {
    const options = creationOptionsFromJSON({
      challenge: "AQID",
      user: { id: "BAUG", name: "alice", displayName: "alice" },
      excludeCredentials: [{ id: "BwgJ", type: "public-key" }],
    });
    expect(Array.from(new Uint8Array(options.challenge as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(Array.from(new Uint8Array(options.user.id as ArrayBuffer))).toEqual([4, 5, 6]);
    expect(Array.from(new Uint8Array(options.excludeCredentials![0].id as ArrayBuffer))).toEqual([7, 8, 9]);

    const request = requestOptionsFromJSON({ challenge: "AQID", rpId: "x", allowCredentials: [] });
    expect(request.rpId).toBe("x");
    expect(request.allowCredentials).toEqual([]);
  });
});

describe("passkeysSupported", () => {
  it("is false when the browser has no PublicKeyCredential", () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    expect(passkeysSupported()).toBe(false);
  });

  it("is true with PublicKeyCredential and navigator.credentials", () => {
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    vi.stubGlobal("navigator", { credentials: {} });
    expect(passkeysSupported()).toBe(true);
  });
});

describe("passkeys without a secure connection", () => {
  function stubBrowser(hostname: string, isSecureContext: boolean) {
    vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
    vi.stubGlobal("navigator", { credentials: {} });
    vi.stubGlobal("isSecureContext", isSecureContext);
    vi.stubGlobal("location", { hostname });
  }

  it("explains why on plain http", () => {
    stubBrowser("homeserver.local", false);
    expect(passkeysSupported()).toBe(false);
    expect(passkeyConnectionNote()).toMatch(/secure \(https\) connection/);
  });

  it("explains why on a bare IP address", () => {
    stubBrowser("192.168.1.20", true);
    expect(passkeysSupported()).toBe(false);
    expect(passkeyConnectionNote()).not.toBeNull();
  });

  it("has no note over https on a host name", () => {
    stubBrowser("myhost.tailxyz.ts.net", true);
    expect(passkeysSupported()).toBe(true);
    expect(passkeyConnectionNote()).toBeNull();
  });
});

function fakeCredential(response: Record<string, unknown>) {
  return {
    id: "AQID",
    rawId: Uint8Array.from([1, 2, 3]).buffer,
    type: "public-key",
    response,
    getClientExtensionResults: () => ({}),
  };
}

describe("ceremonies", () => {
  it("registers: options -> navigator.credentials.create -> verify", async () => {
    const create = vi.fn().mockResolvedValue(
      fakeCredential({
        clientDataJSON: Uint8Array.from([1]).buffer,
        attestationObject: Uint8Array.from([2]).buffer,
        getTransports: () => ["internal"],
      }),
    );
    vi.stubGlobal("navigator", { credentials: { create } });
    const fetchMock = mockFetch((url) => {
      if (url === "/api/auth/passkeys/register/options") {
        return jsonResponse({
          challenge_id: "c1",
          options: { challenge: "AQID", user: { id: "BAUG", name: "a", displayName: "a" } },
        });
      }
      if (url === "/api/auth/passkeys/register/verify") {
        return jsonResponse({ id: "p1", name: "Phone", created_at: "2026-01-01 00:00:00", last_used_at: null }, 201);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const passkey = await registerPasskey("Phone", "hunter2-hunter2");

    expect(passkey.id).toBe("p1");
    expect(create).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ password: "hunter2-hunter2" });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.challenge_id).toBe("c1");
    expect(body.name).toBe("Phone");
    expect(body.credential.response).toEqual({ clientDataJSON: "AQ", attestationObject: "Ag", transports: ["internal"] });
  });

  it("signs in: options -> navigator.credentials.get -> verify", async () => {
    const get = vi.fn().mockResolvedValue(
      fakeCredential({
        clientDataJSON: Uint8Array.from([1]).buffer,
        authenticatorData: Uint8Array.from([2]).buffer,
        signature: Uint8Array.from([3]).buffer,
        userHandle: Uint8Array.from([4]).buffer,
      }),
    );
    vi.stubGlobal("navigator", { credentials: { get } });
    const fetchMock = mockFetch((url) => {
      if (url === "/api/auth/passkeys/login/options") {
        return jsonResponse({ challenge_id: "c2", options: { challenge: "AQID", rpId: "x", allowCredentials: [] } });
      }
      if (url === "/api/auth/passkeys/login/verify") return jsonResponse({ username: "alice", role: "user" });
      throw new Error(`unexpected request: ${url}`);
    });

    const user = await loginWithPasskey(true, "pwa");

    expect(user.username).toBe("alice");
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({ challenge_id: "c2", remember_me: true, client: "pwa" });
    expect(body.credential.response.userHandle).toBe("BA");
  });
});
