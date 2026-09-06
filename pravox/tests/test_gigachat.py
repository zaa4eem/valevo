import io
import json
import unittest
from unittest.mock import patch
from app.ai import LegalAI
from app.config import Config
from app.errors import UpstreamError


class GigaChatTests(unittest.TestCase):
    def setUp(self):
        from app.gigachat_ai import GigaChatAI
        GigaChatAI._token, GigaChatAI._expires = None, 0
        self.config = Config(bot_token='test', public_url='https://zaa4eem.ru/pravoXru',
                             ai_backend='gigachat', ai_model='GigaChat', gigachat_auth_key='base64-test-key')

    def test_config_needs_authorization_key(self):
        self.assertEqual(self.config.validate(), [])
        self.assertIn('GIGACHAT_AUTH_KEY / GIGACHAT_SCOPE',
                      Config(bot_token='t', public_url='https://zaa4eem.ru', ai_backend='gigachat', ai_model='GigaChat').validate())

    def test_token_then_chat_request(self):
        token = {'access_token': 'short-lived-token', 'expires_at': 4102444800000}
        chat = {'choices': [{'message': {'content': '[[ANSWER]] Предварительный разбор.'}}],
                'usage': {'prompt_tokens': 13, 'completion_tokens': 21}}
        with patch('urllib.request.urlopen', side_effect=[io.BytesIO(json.dumps(token).encode()), io.BytesIO(json.dumps(chat).encode())]) as request:
            answer = LegalAI(self.config).answer('Вопрос', 'citizen', [])
        oauth, completion = [call.args[0] for call in request.call_args_list]
        self.assertEqual(oauth.full_url, 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth')
        self.assertEqual(oauth.get_header('Authorization'), 'Basic base64-test-key')
        self.assertEqual(completion.full_url, 'https://api.giga.chat/v1/chat/completions')
        self.assertEqual(completion.get_header('Authorization'), 'Bearer short-lived-token')
        self.assertEqual(json.loads(completion.data)['model'], 'GigaChat')
        self.assertIn('проверьте актуальную редакцию', answer.text)
        self.assertEqual((answer.input_tokens, answer.output_tokens, answer.sources), (13, 21, []))

    def test_auth_error_has_no_secret(self):
        from urllib.error import HTTPError
        error = HTTPError('https://secret.example', 401, 'bad', {}, io.BytesIO())
        with patch('urllib.request.urlopen', side_effect=error):
            with self.assertRaises(UpstreamError) as caught:
                LegalAI(self.config).answer('Вопрос', 'citizen', [])
        self.assertNotIn('base64-test-key', str(caught.exception))

    def test_bad_model_response_not_countable(self):
        token = {'access_token': 'short-lived-token', 'expires_at': 4102444800000}
        chat = {'choices': [{'message': {'content': ''}}]}
        with patch('urllib.request.urlopen', side_effect=[io.BytesIO(json.dumps(token).encode()), io.BytesIO(json.dumps(chat).encode())]):
            with self.assertRaises(UpstreamError):
                LegalAI(self.config).answer('Вопрос', 'citizen', [])


if __name__ == '__main__': unittest.main()
