import io
import json
import unittest
from dataclasses import replace
from unittest.mock import patch
from app.ai import LegalAI
from app.config import Config
from app.errors import UpstreamError
from app.local_ai import NOTICE, parse_local


def reply(text='Предварительное объяснение.', kind='answer', **fields):
    return dict(done=True, done_reason='stop', message={'content': json.dumps({'kind': kind, 'text': text})},
                prompt_eval_count=12, eval_count=20, **fields)


class LocalTests(unittest.TestCase):
    def setUp(self):
        self.config = Config(bot_token='test', public_url='https://zaa4eem.ru/pravoXru',
                             ai_backend='ollama', ai_model='qwen3:4b')

    def test_no_key_required(self):
        self.assertTrue(self.config.ai_ready)
        self.assertEqual(self.config.validate(), [])

    def test_external_adapter_still_requires_key(self):
        self.assertFalse(replace(self.config, ai_backend='responses').ai_ready)

    def test_local_answer_always_marked_unverified(self):
        answer = parse_local(reply())
        self.assertTrue(answer.text.startswith(NOTICE))
        self.assertEqual(answer.sources, [])
        self.assertEqual(answer.search_calls, 0)
        self.assertEqual(answer.input_tokens, 12)

    def test_no_out_of_scope_charge_kind(self):
        self.assertEqual(parse_local(reply(kind='out_of_scope')).kind, 'out_of_scope')

    def test_truncated_or_invalid_response_rejected(self):
        for field, value in [('done', False), ('done_reason', 'length')]:
            data = reply(); data[field] = value
            with self.assertRaises(UpstreamError): parse_local(data)
        for text, kind in [('', 'answer'), ('x', 'invented'), (123, 'answer')]:
            with self.assertRaises(UpstreamError): parse_local(reply(text, kind))

    def test_no_external_or_credentialed_ollama_endpoint(self):
        for url in ['http://example.com:11434', 'http://ollama:11434.evil.test',
                    'http://user:pass@ollama:11434', 'http://ollama:11434/?x=1']:
            self.assertTrue(replace(self.config, ollama_url=url).validate())

    def test_real_adapter_contract_and_limited_context(self):
        with patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(reply()).encode())) as http:
            answer = LegalAI(self.config).answer('Что такое сделка?', 'student',
                [{'role': 'user', 'text': 'x'*2000}] * 8)
        request = http.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(request.full_url, 'http://ollama:11434/api/chat')
        self.assertIsNone(request.get_header('Authorization'))
        self.assertFalse(payload['stream'])
        self.assertFalse(payload['think'])
        self.assertEqual(len(payload['messages']), 6)
        self.assertLessEqual(len(payload['messages'][1]['content']), 1600)
        self.assertEqual(answer.kind, 'answer')

    def test_network_errors_do_not_expose_details(self):
        with patch('urllib.request.urlopen', side_effect=OSError('sensitive details')):
            with self.assertRaises(UpstreamError) as caught:
                LegalAI(self.config).answer('Вопрос', 'citizen', [])
        self.assertNotIn('sensitive', str(caught.exception))


if __name__ == '__main__': unittest.main()
