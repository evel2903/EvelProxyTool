"""Offline inference-format experiment, not a desktop integration.

No HTTP listener, process launch, credential access, or application changes.
The native desktop's control-plane and streaming contracts remain unverified.
"""

import codecs
import copy
import json
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass


class ProtocolError(ValueError):
    """Unsupported input; messages deliberately exclude request contents."""


@dataclass(frozen=True)
class GeminiRequest:
    path: str
    body: dict
    requested_model: str
    selected_model: str


_ACTIONS = {
    "/v1internal:generateContent": "generateContent",
    "/v1internal:streamGenerateContent": "streamGenerateContent",
}


def prepare_inference(path: str, envelope: dict, selected_model: str) -> GeminiRequest:
    """Translate only synthetic inference envelopes to CPA's Gemini format.

    The explicit selected model represents the future EvelProxyTool selection.
    Other Cloud Code methods need separate analysis; never fabricate entitlement,
    authentication, quota, or model-discovery responses to make a probe pass.
    """
    if path not in _ACTIONS:
        raise ProtocolError("Unsupported Cloud Code method or query")
    if not isinstance(envelope, dict) or not isinstance(envelope.get("request"), dict):
        raise ProtocolError("Expected a Cloud Code request envelope")
    requested = envelope.get("model")
    if not isinstance(requested, str) or not requested.strip():
        raise ProtocolError("Missing requested model")
    if not isinstance(selected_model, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}", selected_model
    ):
        raise ProtocolError("Unsupported selected model identifier")
    if "model" in envelope["request"]:
        raise ProtocolError("Nested model requires contract verification")
    action = _ACTIONS[path]
    suffix = "?alt=sse" if action == "streamGenerateContent" else ""
    return GeminiRequest(
        path=f"/v1beta/models/{selected_model}:{action}{suffix}",
        body=copy.deepcopy(envelope["request"]),
        requested_model=requested,
        selected_model=selected_model,
    )


def wrap_inference_response(response: dict) -> dict:
    """Candidate inverse of CPA's Antigravity response-envelope removal.

    This preserves tool calls, signatures, finish reasons and usage verbatim.
    It does not invent success, response IDs, or a terminal streaming event.
    """
    if not isinstance(response, dict):
        raise ProtocolError("Expected a Gemini response object")
    if "response" in response:
        raise ProtocolError("Response is already enveloped")
    if "error" in response:
        return copy.deepcopy(response)
    if not any(k in response for k in ("candidates", "usageMetadata", "promptFeedback", "cpaUsageMetadata")):
        raise ProtocolError("Unrecognized Gemini response")
    return {"response": copy.deepcopy(response)}


def _translate_event(lines: list[str]) -> str:
    data = []
    for line in lines:
        field, separator, value = line.partition(":")
        if field == "data":
            data.append(value.removeprefix(" ") if separator else "")
    if not data:
        return "\n".join(lines) + "\n\n"
    try:
        response = json.loads("\n".join(data))
    except (ValueError, TypeError):
        raise ProtocolError("Unrecognized SSE data payload") from None
    wrapped = json.dumps(wrap_inference_response(response), ensure_ascii=False, separators=(",", ":"))
    output = []
    inserted = False
    for line in lines:
        if line.partition(":")[0] == "data":
            if not inserted:
                output.append("data: " + wrapped)
                inserted = True
        else:
            output.append(line)
    return "\n".join(output) + "\n\n"


def translate_sse(chunks: Iterable[bytes], max_event_bytes: int = 1_048_576) -> Iterator[bytes]:
    """Exercise incremental SSE translation using fixture bytes only.

    A truncated event is rejected instead of silently becoming a successful
    completion. Limits apply to one event, not to the entire conversation.
    """
    if max_event_bytes < 1:
        raise ProtocolError("Invalid event limit")
    decoder = codecs.getincrementaldecoder("utf-8")("strict")
    pending = ""
    lines = []
    event_bytes = 0
    try:
        for chunk in chunks:
            pending += decoder.decode(chunk)
            while "\n" in pending:
                line, pending = pending.split("\n", 1)
                event_bytes += len(line.encode("utf-8")) + 1
                if event_bytes > max_event_bytes:
                    raise ProtocolError("SSE event exceeds fixture limit")
                line = line.removesuffix("\r")
                if line:
                    lines.append(line)
                else:
                    if lines:
                        yield _translate_event(lines).encode("utf-8")
                    lines = []
                    event_bytes = 0
            if event_bytes + len(pending.encode("utf-8")) > max_event_bytes:
                raise ProtocolError("SSE event exceeds fixture limit")
        pending += decoder.decode(b"", final=True)
    except UnicodeError:
        raise ProtocolError("Invalid UTF-8 in SSE stream") from None
    if pending or lines:
        raise ProtocolError("Truncated SSE event")
