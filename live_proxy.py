"""GPT-Live 1 WebRTC session creation, isolated from ASTER's saved conversation.

Use the API key only on the local server. No voice audio, transcripts, or
API credentials are persisted by this module.
"""
import json
import os
import urllib.error
import urllib.request

ENDPOINT = "https://api.openai.com/v1/live/sessions"
MAX_OFFER_BYTES = 65_536
MAX_RESPONSE_BYTES = 262_144
VOICES = frozenset(("marin", "shida", "harema"))
PROMPT = (
    "あなたは個人用の音声アシスタント、ASTER（アスター）。日本語で会話する。"
    "抑揚や間を自然にし、文章を読み上げるように話さない。短い質問には前置きなく短く答える。"
    "相手の話の途中に軽い相づちを打ってもよいが、聞き取りを邪魔しない。"
    "ユーザーが割り込んだらすぐ話すのをやめて、訂正や追加の説明を聞く。"
    "句読点・記号・改行などの表記方法を口にしない。"
    "事実確認・調査・複雑な作業が必要なら、連携された回答モデルへ処理を引き継ぐ。"
    "調査結果が届くまでは、確認できていない事実を断定しない。"
    "この試験画面からASTERのローカルの長期記憶や予定を変更する機能はない。"
    "予定を設定した、過去の記憶を読んだなどと装わない。\n"
    "Backchannel policy: brief and occasional, never competing with the user's speech.\n"
    "Interruption policy: yield immediately when the user changes topic, corrects, or asks to stop.\n"
    "Delegation policy:\n"
    "Backend tools: Responses model for reasoning, drafting, and current information via web search.\n"
    "Generate <|SpawnThinking|> when: the user requests research, detailed reasoning, or a task needing backend tools.\n"
    "Do not generate <|SpawnThinking|> when: casual conversation or a brief clarification is sufficient.\n"
    "Generate <|SpawnThinking|> before giving an answer that depends on backend work."
)


class LiveCallError(Exception):
    """Safe error message for a caller starting a GPT-Live session."""


def create_live_session(sdp: str, voice: str = "marin") -> dict:
    """Exchange an SDP offer for a GPT-Live WebRTC answer."""
    if not isinstance(sdp, str) or not 50 <= len(sdp.encode("utf-8")) <= MAX_OFFER_BYTES:
        raise ValueError("SDPの長さが不正です。")
    if not sdp.startswith(("v=0\r\n", "v=0\n")):
        raise ValueError("SDPの形式が不正です。")
    if voice not in VOICES:
        raise ValueError("この音声は選べません。")
    key = os.environ.get("ASSISTANT_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise LiveCallError("OpenAI APIキーがありません。ASTERのAPI設定を確認してください。")

    session = {
        "model": "gpt-live-1",
        "instructions": PROMPT,
        "audio": {"output": {"voice": voice}},
        "client": {
            "data_channel": {
                "allowed_client_events": [
                    "session.input_audio.mute",
                    "session.input_audio.unmute",
                    "session.close",
                ],
                "allowed_server_events": "all",
            },
        },
        "store": False,
        "delegation": {
            "type": "responses",
            "responses": {
                "model": "gpt-5.6-terra",
                "instructions": (
                    "Assist ASTER with research and task reasoning in Japanese. "
                    "Search the web for time-sensitive facts; never invent a source. "
                    "Return a concise answer suitable for spoken delivery. "
                    "Do not claim access to ASTER local memories, calendar, or private files."
                ),
                "tools": [{"type": "web_search"}],
                "tool_choice": "auto",
            },
        },
    }
    payload = json.dumps(
        {"session": session, "transport": {"type": "webrtc", "sdp": sdp}},
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise LiveCallError("APIキーまたはGPT-Liveの利用権限を確認してください。") from error
        if error.code in (402, 429):
            raise LiveCallError("APIの利用枠・残高・同時接続制限を確認してください。") from error
        raise LiveCallError(f"GPT-Liveへの接続が拒否されました（HTTP {error.code}）。") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise LiveCallError("GPT-Liveへの接続に失敗しました。ネットワークを確認してください。") from error
    if len(data) > MAX_RESPONSE_BYTES:
        raise LiveCallError("音声APIの応答サイズが不正です。")
    try:
        result = json.loads(data)
        session_id = result["session"]["id"]
        transport = result["transport"]
        answer = transport["sdp"]
        if (not isinstance(session_id, str) or not session_id.startswith("live_") or
                transport["type"] != "webrtc" or not isinstance(answer, str) or
                not answer.startswith("v=0") or len(answer.encode("utf-8")) > MAX_RESPONSE_BYTES):
            raise ValueError("invalid session result")
    except (KeyError, ValueError, TypeError, AttributeError) as error:
        raise LiveCallError("音声APIから有効な接続情報が返りませんでした。") from error
    return {
        "session": {"id": session_id},
        "transport": {"type": "webrtc", "sdp": answer},
    }
