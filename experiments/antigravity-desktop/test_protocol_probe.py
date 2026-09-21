import copy
import json
import unittest

from protocol_probe import ProtocolError, prepare_inference, translate_sse, wrap_inference_response


class InferenceContractTests(unittest.TestCase):
    def setUp(self):
        self.envelope = {
            "model": "native-default",
            "project": "synthetic-google-project",
            "requestId": "synthetic-request",
            "request": {
                "systemInstruction": {"parts": [{"text": "Synthetic fixture"}]},
                "contents": [
                    {"role": "model", "parts": [{"functionCall": {"name": "read_fixture", "args": {}}, "thoughtSignature": "synthetic-signature"}]},
                    {"role": "user", "parts": [{"functionResponse": {"name": "read_fixture", "response": {"result": "ok"}}}]},
                ],
                "tools": [{"functionDeclarations": [{"name": "read_fixture", "parameters": {"type": "OBJECT", "additionalProperties": False}}]}],
                "generationConfig": {"thinkingConfig": {"thinkingBudget": 128}},
            },
        }

    def test_selected_model_controls_route_and_google_envelope_is_not_forwarded(self):
        original = copy.deepcopy(self.envelope)
        request = prepare_inference("/v1internal:generateContent", self.envelope, "gemini-test-high")
        self.assertEqual(request.path, "/v1beta/models/gemini-test-high:generateContent")
        self.assertEqual(request.requested_model, "native-default")
        self.assertEqual(request.body, original["request"])
        self.assertNotIn("project", request.body)
        self.assertNotIn("requestId", request.body)
        request.body["contents"].clear()
        self.assertEqual(self.envelope, original)

    def test_streaming_uses_gemini_sse_endpoint(self):
        request = prepare_inference("/v1internal:streamGenerateContent", self.envelope, "gemini-test")
        self.assertEqual(request.path, "/v1beta/models/gemini-test:streamGenerateContent?alt=sse")

    def test_control_plane_and_unknown_queries_require_separate_verification(self):
        for path in ("/v1internal:loadCodeAssist", "/v1internal:fetchAvailableModels", "/v1internal:countTokens", "/v1internal:generateContent?unknown=1"):
            with self.subTest(path=path), self.assertRaises(ProtocolError):
                prepare_inference(path, self.envelope, "gemini-test")

    def test_invalid_model_cannot_change_route(self):
        for model in ("", "../management", "model?key=secret", "model/path", "model\r\nheader", " model", None):
            with self.subTest(model=model), self.assertRaises(ProtocolError):
                prepare_inference("/v1internal:generateContent", self.envelope, model)

    def test_invalid_envelopes_do_not_leak_their_contents(self):
        for envelope in (None, [], {"model": "private", "request": []}, {"request": {}}, {"model": "private", "request": {"model": "private"}}):
            with self.subTest(envelope=envelope), self.assertRaises(ProtocolError) as caught:
                prepare_inference("/v1internal:generateContent", envelope, "gemini-test")
            self.assertNotIn("private", str(caught.exception))

    def test_response_preserves_tool_signature_finish_and_usage(self):
        response = {"candidates": [{"content": self.envelope["request"]["contents"][0], "finishReason": "STOP"}], "usageMetadata": {"totalTokenCount": 7}, "responseId": "synthetic-response"}
        self.assertEqual(wrap_inference_response(response), {"response": response})

    def test_error_is_not_wrapped_as_success(self):
        error = {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "Synthetic quota error"}}
        self.assertEqual(wrap_inference_response(error), error)
        with self.assertRaises(ProtocolError):
            wrap_inference_response({"response": {"candidates": []}})

    def test_blocked_prompt_and_usage_only_response_survive(self):
        for response in ({"promptFeedback": {"blockReason": "SAFETY"}}, {"usageMetadata": {"totalTokenCount": 4}}, {"cpaUsageMetadata": {"totalTokenCount": 3}}):
            self.assertEqual(wrap_inference_response(response), {"response": response})


class StreamingContractTests(unittest.TestCase):
    def test_every_byte_boundary_including_utf8_and_crlf(self):
        response = {"candidates": [{"content": {"parts": [{"text": "Xin chào anh"}]}}]}
        wire = ("id: fixture\r\nevent: message\r\ndata: " + json.dumps(response, ensure_ascii=False) + "\r\n\r\n").encode()
        expected = b"".join(translate_sse([wire]))
        for boundary in range(len(wire) + 1):
            self.assertEqual(b"".join(translate_sse([wire[:boundary], wire[boundary:]])), expected)
        self.assertEqual(b"".join(translate_sse(bytes([b]) for b in wire)), expected)
        self.assertIn(b"event: message\n", expected)
        self.assertIn(b"id: fixture\n", expected)
        data = expected.decode().split("data: ", 1)[1].strip()
        self.assertEqual(json.loads(data), {"response": response})

    def test_keepalive_multiline_data_and_multiple_events(self):
        wire = b': keepalive\n\ndata: {"candidates": [],\ndata: "usageMetadata": {"totalTokenCount": 2}}\n\n'
        events = list(translate_sse([wire]))
        self.assertEqual(events[0], b": keepalive\n\n")
        self.assertEqual(json.loads(events[1].decode()[6:]), {"response": {"candidates": [], "usageMetadata": {"totalTokenCount": 2}}})

    def test_streaming_error_keeps_error_event_and_does_not_invent_stop(self):
        wire = b'event: error\ndata: {"error":{"code":503}}\n\n'
        output = b"".join(translate_sse([wire]))
        self.assertIn(b"event: error", output)
        self.assertNotIn(b"finishReason", output)
        self.assertNotIn(b'"response"', output)

    def test_truncated_malformed_oversized_and_unknown_payloads_fail(self):
        for wire in (b'data: {"candidates": []}', b'data: nope\n\n', b'data: [DONE]\n\n', b'data: {}\n\n', b'data: \xff\n\n'):
            with self.subTest(wire=wire), self.assertRaises(ProtocolError):
                list(translate_sse([wire]))
        with self.assertRaises(ProtocolError):
            list(translate_sse([b"data: " + b"x" * 32], max_event_bytes=16))

    def test_consumer_can_close_without_reading_another_chunk(self):
        def source():
            yield b'data: {"candidates": []}\n\n'
            self.fail("Read another chunk after consumer cancellation")
        stream = translate_sse(source())
        next(stream)
        stream.close()


if __name__ == "__main__":
    unittest.main()
