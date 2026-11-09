"""P3.1: passkey registration and sign-in ceremonies.

A tiny software authenticator (P-256, `none` attestation) produces real
WebAuthn responses, so the server's verification runs unmodified.
"""

import base64
import hashlib
import json
import struct

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from photos_viewer import app_db, session_auth, session_passkeys
from photos_viewer.main import create_app

ORIGIN = "https://testserver"
RP_ID = "testserver"
PASSWORD = "correct-horse-battery"


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class SoftwareAuthenticator:
    def __init__(self) -> None:
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = hashlib.sha256(
            self.key.public_key().public_numbers().x.to_bytes(32, "big")
        ).digest()
        self.counter = 0
        self.user_handle = b""

    def _client_data(self, kind: str, challenge: str, origin: str) -> bytes:
        return json.dumps(
            {
                "type": kind,
                "challenge": challenge,
                "origin": origin,
                "crossOrigin": False,
            }
        ).encode()

    def create(
        self, options: dict, *, origin: str = ORIGIN, rp_id: str = RP_ID
    ) -> dict:
        self.user_handle = unb64u(options["user"]["id"])
        numbers = self.key.public_key().public_numbers()
        cose = cbor2.dumps(
            {
                1: 2,
                3: -7,
                -1: 1,
                -2: numbers.x.to_bytes(32, "big"),
                -3: numbers.y.to_bytes(32, "big"),
            }
        )
        auth_data = (
            hashlib.sha256(rp_id.encode()).digest()
            + bytes([0x45])  # UP | UV | AT
            + struct.pack(">I", self.counter)
            + bytes(16)
            + struct.pack(">H", len(self.credential_id))
            + self.credential_id
            + cose
        )
        return {
            "id": b64u(self.credential_id),
            "rawId": b64u(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64u(
                    self._client_data("webauthn.create", options["challenge"], origin)
                ),
                "attestationObject": b64u(
                    cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
                ),
                "transports": ["internal"],
            },
            "clientExtensionResults": {},
        }

    def get(
        self,
        options: dict,
        *,
        origin: str = ORIGIN,
        rp_id: str = RP_ID,
        handle: bytes | None = None,
    ) -> dict:
        self.counter += 1
        client_data = self._client_data("webauthn.get", options["challenge"], origin)
        auth_data = (
            hashlib.sha256(rp_id.encode()).digest()
            + bytes([0x05])
            + struct.pack(">I", self.counter)
        )
        signature = self.key.sign(
            auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256())
        )
        return {
            "id": b64u(self.credential_id),
            "rawId": b64u(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64u(client_data),
                "authenticatorData": b64u(auth_data),
                "signature": b64u(signature),
                "userHandle": b64u(self.user_handle if handle is None else handle),
            },
            "clientExtensionResults": {},
        }


@pytest.fixture(autouse=True)
def _reset_caches():
    session_auth.reset_public_origins_cache()
    session_auth.reset_trusted_proxies_cache()
    yield
    session_auth.reset_public_origins_cache()
    session_auth.reset_trusted_proxies_cache()


@pytest.fixture
def db(tmp_path):
    conn = app_db.connect(tmp_path)
    yield conn
    conn.close()


@pytest.fixture
def client(db):
    app = create_app()
    app.dependency_overrides[session_auth.get_db] = lambda: db
    return TestClient(app, base_url=ORIGIN)


def add_user(db, name: str, *, role: str = "user") -> int:
    cursor = db.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        (name, session_auth.hash_password(PASSWORD), role),
    )
    db.commit()
    return cursor.lastrowid


def password_login(client, name: str = "alice") -> None:
    response = client.post(
        "/api/auth/login", json={"username": name, "password": PASSWORD}
    )
    assert response.status_code == 200


def register(client, authenticator: SoftwareAuthenticator, name: str = "Laptop"):
    begun = client.post("/api/auth/passkeys/register/options", json={}).json()
    return client.post(
        "/api/auth/passkeys/register/verify",
        json={
            "challenge_id": begun["challenge_id"],
            "credential": authenticator.create(begun["options"]),
            "name": name,
        },
    )


def passkey_login(http, authenticator: SoftwareAuthenticator, **kwargs):
    begun = http.post("/api/auth/passkeys/login/options", json={}).json()
    return begun, http.post(
        "/api/auth/passkeys/login/verify",
        json={
            "challenge_id": begun["challenge_id"],
            "credential": authenticator.get(begun["options"]),
            **kwargs,
        },
    )


def test_register_then_sign_in_with_the_passkey_alone(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()

    created = register(client, authenticator)
    assert created.status_code == 201
    assert created.json()["name"] == "Laptop"
    assert [p["name"] for p in client.get("/api/auth/passkeys").json()] == ["Laptop"]
    client.post("/api/auth/logout", json={})

    anonymous = TestClient(client.app, base_url=ORIGIN)
    assert anonymous.get("/api/auth/me").status_code == 401
    _, signed_in = passkey_login(anonymous, authenticator)
    assert signed_in.status_code == 200
    assert signed_in.json() == {"username": "alice", "role": "user"}
    assert anonymous.get("/api/auth/me").json()["username"] == "alice"
    assert (
        db.execute("SELECT sign_count, last_used_at FROM passkeys").fetchone()[
            "sign_count"
        ]
        == 1
    )


def test_passwords_still_work_with_a_passkey_registered(client, db):
    add_user(db, "alice")
    password_login(client)
    register(client, SoftwareAuthenticator())
    client.post("/api/auth/logout", json={})
    password_login(client)
    assert client.get("/api/auth/me").status_code == 200


def test_passkey_login_cookie_flags_match_the_password_login(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    register(client, authenticator)
    password_cookie = client.post(
        "/api/auth/login", json={"username": "alice", "password": PASSWORD}
    ).headers["set-cookie"]

    anonymous = TestClient(client.app, base_url=ORIGIN)
    _, response = passkey_login(anonymous, authenticator)
    passkey_cookie = response.headers["set-cookie"]

    def flags(header: str) -> list[str]:
        # Everything but the cookie value itself.
        return sorted(part.strip().lower() for part in header.split(";")[1:])

    assert flags(passkey_cookie) == flags(password_cookie)
    for flag in ("httponly", "secure", "samesite=strict", "path=/"):
        assert flag in flags(passkey_cookie)


def test_passkey_login_honours_client_and_remember_me_lifetimes(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    register(client, authenticator)
    anonymous = TestClient(client.app, base_url=ORIGIN)
    _, response = passkey_login(
        anonymous, authenticator, client="pwa", remember_me=True
    )
    expected = session_auth._DEFAULT_REMEMBER_ME_LIFETIME_SECONDS
    assert f"Max-Age={expected}" in response.headers["set-cookie"]


def test_a_challenge_can_only_be_used_once(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    register(client, authenticator)

    anonymous = TestClient(client.app, base_url=ORIGIN)
    begun = anonymous.post("/api/auth/passkeys/login/options", json={}).json()
    body = {
        "challenge_id": begun["challenge_id"],
        "credential": authenticator.get(begun["options"]),
    }
    assert (
        anonymous.post("/api/auth/passkeys/login/verify", json=body).status_code == 200
    )
    replay = TestClient(client.app, base_url=ORIGIN).post(
        "/api/auth/passkeys/login/verify", json=body
    )
    assert replay.status_code == 400


def test_a_replayed_registration_challenge_is_rejected(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    begun = client.post("/api/auth/passkeys/register/options", json={}).json()
    body = {
        "challenge_id": begun["challenge_id"],
        "credential": authenticator.create(begun["options"]),
    }
    assert (
        client.post("/api/auth/passkeys/register/verify", json=body).status_code == 201
    )
    assert (
        client.post("/api/auth/passkeys/register/verify", json=body).status_code == 400
    )


def test_an_expired_challenge_is_rejected(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    register(client, authenticator)
    anonymous = TestClient(client.app, base_url=ORIGIN)
    begun = anonymous.post("/api/auth/passkeys/login/options", json={}).json()
    db.execute(
        "UPDATE passkey_challenges SET expires_at = datetime('now', '-1 seconds')"
    )
    db.commit()
    response = anonymous.post(
        "/api/auth/passkeys/login/verify",
        json={
            "challenge_id": begun["challenge_id"],
            "credential": authenticator.get(begun["options"]),
        },
    )
    assert response.status_code == 400
    assert anonymous.get("/api/auth/me").status_code == 401


def test_a_login_challenge_cannot_complete_a_registration(client, db):
    add_user(db, "alice")
    password_login(client)
    anonymous = TestClient(client.app, base_url=ORIGIN)
    begun = anonymous.post("/api/auth/passkeys/login/options", json={}).json()
    authenticator = SoftwareAuthenticator()
    own = client.post("/api/auth/passkeys/register/options", json={}).json()["options"]
    # A genuine create() response, but for the *login* challenge id.
    credential = authenticator.create(
        {**own, "challenge": begun["options"]["challenge"]}
    )
    response = client.post(
        "/api/auth/passkeys/register/verify",
        json={"challenge_id": begun["challenge_id"], "credential": credential},
    )
    assert response.status_code == 400


def test_a_registration_challenge_belongs_to_the_user_who_asked(client, db):
    add_user(db, "alice")
    add_user(db, "bob")
    password_login(client, "alice")
    begun = client.post("/api/auth/passkeys/register/options", json={}).json()
    bob = TestClient(client.app, base_url=ORIGIN)
    password_login(bob, "bob")
    authenticator = SoftwareAuthenticator()
    response = bob.post(
        "/api/auth/passkeys/register/verify",
        json={
            "challenge_id": begun["challenge_id"],
            "credential": authenticator.create(begun["options"]),
        },
    )
    assert response.status_code == 400
    assert db.execute("SELECT COUNT(*) FROM passkeys").fetchone()[0] == 0


def test_unknown_credential_is_rejected_and_counts_as_a_failure(client, db):
    add_user(db, "alice")
    anonymous = TestClient(client.app, base_url=ORIGIN)
    _, response = passkey_login(anonymous, SoftwareAuthenticator())
    assert response.status_code == 401
    assert anonymous.get("/api/auth/me").status_code == 401


def test_a_signature_from_another_key_is_rejected(client, db):
    add_user(db, "alice")
    password_login(client)
    real = SoftwareAuthenticator()
    register(client, real)
    forger = SoftwareAuthenticator()
    forger.credential_id = real.credential_id  # same id, different private key
    forger.user_handle = real.user_handle
    anonymous = TestClient(client.app, base_url=ORIGIN)
    _, response = passkey_login(anonymous, forger)
    assert response.status_code == 401


def test_a_passkey_for_another_user_handle_is_rejected(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    register(client, authenticator)
    anonymous = TestClient(client.app, base_url=ORIGIN)
    begun = anonymous.post("/api/auth/passkeys/login/options", json={}).json()
    response = anonymous.post(
        "/api/auth/passkeys/login/verify",
        json={
            "challenge_id": begun["challenge_id"],
            "credential": authenticator.get(begun["options"], handle=b"someone-else"),
        },
    )
    assert response.status_code == 401


def test_wrong_origin_and_wrong_rp_id_are_rejected(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    register(client, authenticator)
    anonymous = TestClient(client.app, base_url=ORIGIN)
    for kwargs in ({"origin": "https://evil.example"}, {"rp_id": "evil.example"}):
        begun = anonymous.post("/api/auth/passkeys/login/options", json={}).json()
        response = anonymous.post(
            "/api/auth/passkeys/login/verify",
            json={
                "challenge_id": begun["challenge_id"],
                "credential": authenticator.get(begun["options"], **kwargs),
            },
        )
        assert response.status_code == 401


def test_a_disabled_account_cannot_sign_in_with_a_passkey(client, db):
    user_id = add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    register(client, authenticator)
    db.execute("UPDATE users SET disabled = 1 WHERE id = ?", (user_id,))
    db.commit()
    anonymous = TestClient(client.app, base_url=ORIGIN)
    _, response = passkey_login(anonymous, authenticator)
    assert response.status_code == 401


def test_repeated_failures_lock_the_account_like_the_password_login(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    register(client, authenticator)
    forger = SoftwareAuthenticator()
    forger.credential_id, forger.user_handle = (
        authenticator.credential_id,
        authenticator.user_handle,
    )
    anonymous = TestClient(client.app, base_url=ORIGIN)
    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS):
        assert passkey_login(anonymous, forger)[1].status_code == 401
    # Locked out: even the genuine passkey is refused until the cool-off ends.
    assert passkey_login(anonymous, authenticator)[1].status_code == 429
    login = anonymous.post(
        "/api/auth/login", json={"username": "alice", "password": PASSWORD}
    )
    assert login.status_code == 429


def test_ip_lockout_applies_to_unknown_credentials(client, db):
    add_user(db, "alice")
    anonymous = TestClient(client.app, base_url=ORIGIN)
    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_IP):
        assert passkey_login(anonymous, SoftwareAuthenticator())[1].status_code == 401
    assert passkey_login(anonymous, SoftwareAuthenticator())[1].status_code == 429


def test_unknown_challenge_ids_count_toward_the_ip_lockout(client, db):
    add_user(db, "alice")
    anonymous = TestClient(client.app, base_url=ORIGIN)
    body = {"challenge_id": "nope", "credential": {}}
    for _ in range(session_auth.MAX_FAILED_LOGIN_ATTEMPTS_PER_IP):
        response = anonymous.post("/api/auth/passkeys/login/verify", json=body)
        assert response.status_code == 400
    locked = anonymous.post("/api/auth/passkeys/login/verify", json=body)
    assert locked.status_code == 429


def test_list_and_remove_only_your_own_passkeys(client, db):
    add_user(db, "alice")
    add_user(db, "bob")
    password_login(client, "alice")
    register(client, SoftwareAuthenticator(), "Alice laptop")
    bob = TestClient(client.app, base_url=ORIGIN)
    password_login(bob, "bob")
    register(bob, SoftwareAuthenticator(), "Bob phone")

    alice_ids = [p["id"] for p in client.get("/api/auth/passkeys").json()]
    bob_ids = [p["id"] for p in bob.get("/api/auth/passkeys").json()]
    assert len(alice_ids) == len(bob_ids) == 1

    assert client.delete(f"/api/auth/passkeys/{bob_ids[0]}").status_code == 404
    assert len(bob.get("/api/auth/passkeys").json()) == 1
    assert client.delete(f"/api/auth/passkeys/{alice_ids[0]}").status_code == 204
    assert client.get("/api/auth/passkeys").json() == []


def test_removed_passkey_can_no_longer_sign_in(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    passkey = register(client, authenticator).json()
    client.delete(f"/api/auth/passkeys/{passkey['id']}")
    anonymous = TestClient(client.app, base_url=ORIGIN)
    assert passkey_login(anonymous, authenticator)[1].status_code == 401


def test_registering_the_same_authenticator_twice_is_refused(client, db):
    add_user(db, "alice")
    password_login(client)
    authenticator = SoftwareAuthenticator()
    assert register(client, authenticator).status_code == 201
    assert register(client, authenticator).status_code == 409
    options = client.post("/api/auth/passkeys/register/options", json={}).json()[
        "options"
    ]
    assert options["excludeCredentials"][0]["id"] == b64u(authenticator.credential_id)


def test_registration_and_management_need_a_session(client):
    anonymous = TestClient(client.app, base_url=ORIGIN)
    assert (
        anonymous.post("/api/auth/passkeys/register/options", json={}).status_code
        == 401
    )
    assert (
        anonymous.post(
            "/api/auth/passkeys/register/verify",
            json={"challenge_id": "x", "credential": {}},
        ).status_code
        == 401
    )
    assert anonymous.get("/api/auth/passkeys").status_code == 401
    assert anonymous.delete("/api/auth/passkeys/abc").status_code == 401


def test_post_routes_keep_the_csrf_guard(client, db):
    add_user(db, "alice")
    password_login(client)
    response = client.post(
        "/api/auth/passkeys/register/options",
        content="{}",
        headers={"content-type": "text/plain"},
    )
    assert response.status_code == 415
    response = client.post(
        "/api/auth/passkeys/login/options",
        json={},
        headers={"origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_rp_id_and_origin_come_from_the_environment_when_set(client, db, monkeypatch):
    add_user(db, "alice")
    password_login(client)
    monkeypatch.setenv("PHOTOS_VIEWER_WEBAUTHN_RP_ID", "box.ts.net")
    monkeypatch.setenv("PHOTOS_VIEWER_WEBAUTHN_ORIGINS", "https://box.ts.net")
    authenticator = SoftwareAuthenticator()
    begun = client.post("/api/auth/passkeys/register/options", json={}).json()
    assert begun["options"]["rp"]["id"] == "box.ts.net"
    response = client.post(
        "/api/auth/passkeys/register/verify",
        json={
            "challenge_id": begun["challenge_id"],
            "credential": authenticator.create(
                begun["options"], origin="https://box.ts.net", rp_id="box.ts.net"
            ),
        },
    )
    assert response.status_code == 201


def test_default_rp_id_is_the_request_host(client, db):
    add_user(db, "alice")
    password_login(client)
    begun = client.post("/api/auth/passkeys/register/options", json={}).json()
    assert begun["options"]["rp"]["id"] == RP_ID


def test_pending_challenges_are_bounded(client, monkeypatch):
    monkeypatch.setattr(session_passkeys, "MAX_PENDING_CHALLENGES", 5)
    for _ in range(12):
        assert (
            client.post("/api/auth/passkeys/login/options", json={}).status_code == 200
        )
    db = client.app.dependency_overrides[session_auth.get_db]()
    assert db.execute("SELECT COUNT(*) FROM passkey_challenges").fetchone()[0] <= 5
