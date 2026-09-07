import tempfile
import unittest
import xml.etree.ElementTree as ET
from dataclasses import replace
from unittest.mock import Mock

from app.bot import Bot, privacy_text
from app.config import Config
from app.db import Database
from app.message_style import render_message, welcome_text, mode_text
from app.service import Service
from app.telegram import Telegram, split_message
from app.ai import Answer


class MessageStyleTests(unittest.TestCase):
    def test_headings_and_bullets(self):
        self.assertEqual(render_message("## Что делать\n- **Первый шаг**\nИсточники:"),
                         "<b>Что делать</b>\n• <b>Первый шаг</b>\n<b>Источники:</b>")

    def test_html_from_model_is_never_executed(self):
        rendered = render_message('**<a href="tg://user?id=1">Имя</a>** & <script>')
        root = ET.fromstring("<root>" + rendered + "</root>")
        self.assertEqual([node.tag for node in root.iter()], ["root", "b"])
        self.assertIn("&lt;script&gt;", rendered)
        self.assertIn("&amp;", rendered)

    def test_inline_code_and_unmatched_markers(self):
        self.assertEqual(render_message("`<x>&` **не закрыто"),
                         "<code>&lt;x&gt;&amp;</code> **не закрыто")

    def test_long_messages_valid_and_lossless(self):
        raw = ("**Заголовок**\n\nТекст 😀 & <норма>\n" * 500)
        chunks = split_message(raw)
        self.assertEqual("".join(chunks), raw)
        for chunk in chunks:
            self.assertLessEqual(len(chunk.encode("utf-16-le")) // 2, 3500)
            ET.fromstring("<root>" + render_message(chunk) + "</root>")

    def test_split_prefers_paragraph(self):
        raw = "А" * 20 + "\n\n" + "Б" * 20
        self.assertEqual(split_message(raw, 30), ["А" * 20 + "\n\n", "Б" * 20])

    def test_empty_and_tiny_limits(self):
        self.assertEqual(split_message(""), [])
        self.assertEqual(split_message("😀😀", 2), ["😀", "😀"])
        with self.assertRaises(ValueError):
            split_message("😀", 1)

    def test_send_uses_html_and_keeps_keyboard(self):
        telegram = Telegram(Config())
        telegram.call = Mock(return_value={})
        keyboard = [[{"text": "Начать", "callback_data": "accept"}]]
        telegram.send(17, "**правоХ**", keyboard)
        method, payload = telegram.call.call_args.args
        self.assertEqual(method, "sendMessage")
        self.assertEqual(payload["parse_mode"], "HTML")
        self.assertEqual(payload["text"], "<b>правоХ</b>")
        self.assertEqual(payload["reply_markup"]["inline_keyboard"], keyboard)

    def test_welcome_and_modes_have_no_operator(self):
        self.assertNotIn("Оператор", welcome_text())
        self.assertIn("/privacy", welcome_text())
        self.assertIn("3 запроса", welcome_text())
        self.assertIn("Учебный разбор", mode_text("student"))
        self.assertIn("Разберём вашу ситуацию", mode_text("citizen"))


class ChatFlowStyleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = replace(Config(), db_path=self.tmp.name + "/db.sqlite",
                              ai_key="test-only", ai_model="test-model",
                              operator_name="OWNER_SENTINEL",
                              support_contact="@private_owner",
                              public_url="https://example.org/pravoXru",
                              requests_per_minute=100)
        self.db = Database(self.config.db_path)
        self.tg = Telegram(self.config)
        self.tg.call = Mock(return_value={})
        self.ai = Mock()
        self.ai.answer.return_value = Answer("**По существу**\nОтвет", [], "answer", 1, 1, 0)
        self.service = Service(self.config, self.db, self.tg, self.ai)
        self.bot = Bot(self.service)

    def tearDown(self):
        self.tmp.cleanup()

    def message(self, text):
        self.bot.handle({"update_id": 1, "message": {
            "from": {"id": 17, "first_name": "Тест"},
            "chat": {"id": 17, "type": "private"}, "text": text}})
        return self.tg.call.call_args.args[1]["text"]

    def test_first_start_does_not_disclose_operator_or_grant_consent(self):
        text = self.message("/start")
        self.assertNotIn("OWNER_SENTINEL", text)
        self.assertNotIn("@private_owner", text)
        self.assertIn("<b>правоХ", text)
        self.assertFalse(self.db.one("SELECT consent FROM users WHERE id=17")["consent"])
        self.assertIn("OWNER_SENTINEL", self.message("/privacy"))
        self.assertIn("@private_owner", privacy_text(self.config))

    def test_accept_then_menu_preserves_privacy_and_consent(self):
        self.message("/start")
        self.bot.handle({"callback_query": {"id": "cb", "data": "accept",
                         "from": {"id": 17}, "message": {"chat": {"id": 17, "type": "private"}}}})
        self.assertTrue(self.db.one("SELECT consent FROM users WHERE id=17")["consent"])
        self.assertNotIn("OWNER_SENTINEL", self.message("/start"))

    def test_answer_style_only_changes_telegram_presentation(self):
        self.message("/start")
        self.db.execute("UPDATE users SET consent=1 WHERE id=17")
        job = self.service.submit(17, "Вопрос", "style-test", "telegram")
        self.service.process_one()
        stored = self.db.one("SELECT answer FROM jobs WHERE id=?", (job["id"],))["answer"]
        self.assertEqual(stored, "**По существу**\nОтвет")
        queued = self.db.one("SELECT text FROM outbox WHERE user_id=17")["text"]
        self.assertTrue(queued.startswith("**Разбор вопроса**"))
        self.bot.deliver_one()
        self.assertIn("<b>Разбор вопроса</b>", self.tg.call.call_args.args[1]["text"])


if __name__ == "__main__":
    unittest.main()
