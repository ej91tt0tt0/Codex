"""Local-only OpenAI Realtime WebRTC session negotiation.

This module never sends an API key to the browser. Realtime speech content is
not copied into ASTER's persistent SQLite conversation history in this MVP.
"""
import json
import os
import uuid
import urllib.error
import urllib.request

MAX_OFFER_BYTES = 65_536
MAX_ANSWER_BYTES = 262_144
ENDPOINT = "https://api.openai.com/v1/realtime/calls"


class RealtimeCallError(Exception):
    """A safe, user-facing error for WebRTC setup."""


def create_realtime_call(offer: bytes) -> bytes:
    """Exchange a browser SDP offer for an SDP answer through OpenAI."""
    if not isinstance(offer, bytes) or not 50 <= len(offer) <= MAX_OFFER_BYTES:
        raise ValueError("SDPの長さが不正です。")
    if not offer.startswith(b"v=0\r\n") and not offer.startswith(b"v=0\n"):
        raise ValueError("SDP形式を確認してください。")
    key = os.environ.get("ASSISTANT_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RealtimeCallError("音声AIを使うにはOpenAI APIキーが必要です。")
    # Keep the API key server-side and send only the minimum session config.
    session = {
        "type": "realtime",
        "model": os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1-mini"),
        "instructions": (
            "あなたはASTER（アスター）。日本語で自然に、簡潔で親しみやすく話します。"
            "会話の前後関係を大切にし、分からないことは正直に伝えてください。"
            "この通話では外部検索、予定操作、永続記憶へのアクセスはできません。"
            "それらを実行したと装わず、必要なら通常画面を案内してください。"
        ),
        "audio": {
            "output": {"voice": "marin"},
            "input": {"turn_detection": {
                "type": "server_vad",
                "create_response": True,
                "interrupt_response": True,
            }},
        },
    }
    boundary = "aster-realtime-" + uuid.uuid4().hex
    def part(name: str, data: bytes) -> bytes:
        return (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n"
            "Content-Type: application/json\r\n\r\n"
        ).encode() + data + b"\r\n"

    # SDP is text/plain, not JSON.
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"sdp\"\r\n"
        "Content-Type: application/sdp\r\n\r\n"
    ).encode() + offer + b"\r\n"
    body += part("session", json.dumps(session, ensure_ascii=False).encode("utf-8"))
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        ENDPOINT,
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "multipart/form-data; boundary=" + boundary,
            "Accept": "application/sdp",
        },
    )
    try:
        # Do not obey proxy environment variables for this app's local endpoints;
        # urllib's HTTPS handling is used only for the fixed OpenAI hostname.
        with urllib.request.urlopen(req, timeout=25) as response:
            answer = response.read(MAX_ANSWER_BYTES + 1)
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise RealtimeCallError("APIキーを確認してください。") from error
        if error.code in (402, 429):
            raise RealtimeCallError("APIの利用枠または制限を確認してください。") from error
        raise RealtimeCallError(f"音声APIに接続できませんでした（HTTP {error.code}）。") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise RealtimeCallError("音声APIへの接続がタイムアウトしました。") from error
    if not answer.startswith(b"v=0") or len(answer) > MAX_ANSWER_BYTES:
        raise RealtimeCallError("音声APIから有効な接続情報が返りませんでした。")
    return answer
