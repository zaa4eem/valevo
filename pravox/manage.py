import argparse
import json
from pathlib import Path
from app.config import Config
from app.db import Database
from app.telegram import Telegram
from app.ai import LegalAI
from app.errors import AppError


def main():
    parser=argparse.ArgumentParser(description='правоХ: installation and diagnostics')
    parser.add_argument('command',choices=['check','configure-telegram','backup','smoke-ai'])
    args=parser.parse_args();config=Config.from_env()
    problems=config.validate()
    if problems:raise SystemExit('Missing configuration: '+', '.join(problems))
    db=Database(config.db_path);tg=Telegram(config)
    try:
        if args.command=='backup':
            print('Backup created:',db.backup(Path(config.db_path).parent/'backups'));return
        if args.command=='smoke-ai':
            result=LegalAI(config).answer('Объясни отличие ничтожной сделки от оспоримой по ГК РФ, со ссылками на действующие нормы.','student',[])
            print(json.dumps({'status':'ok','mode':'local_unverified_test' if config.local_ai else 'responses_with_search','sources':len(result.sources),'input_tokens':result.input_tokens,'output_tokens':result.output_tokens,'search_calls':result.search_calls},ensure_ascii=False));return
        me=tg.call('getMe')
        channel=tg.call('getChatMember',{'chat_id':config.channel,'user_id':me['id']})
        if channel.get('status') not in ('administrator','creator'):
            raise SystemExit('Bot must be an administrator in the configured channel.')
        webhook=tg.call('getWebhookInfo')
        if webhook.get('url'):
            raise SystemExit('An existing webhook is configured. Review before switching to polling; it was not removed.')
        db.set_setting('bot_username',me['username'])
        if args.command=='configure-telegram':
            commands=[('start','Открыть меню'),('new','Новый диалог'),('app','Открыть приложение'),('history','Выбрать диалог'),('student','Режим студента'),('citizen','Режим гражданина'),('privacy','Обработка обращений'),('delete','Удалить историю'),('admin','Статистика администратора')]
            tg.call('setMyCommands',{'commands':[{'command':c,'description':d} for c,d in commands],'language_code':'ru'})
            tg.call('setChatMenuButton',{'menu_button':{'type':'web_app','text':'правоХ','web_app':{'url':config.public_url.rstrip('/')+'/'}}})
            tg.call('setMyDescription',{'description':'правоХ — ИИ-помощник по праву России. Для граждан: разбор ситуации и порядок действий. Для студентов: нормы, примеры и объяснения. Первые 3 запроса без подписки, затем бесплатно для подписчиков @pravoXru. Ответы требуют проверки по источникам.'})
            tg.call('setMyShortDescription',{'short_description':'Право на понятном языке. ИИ-помощник для граждан и студентов. Канал: @pravoXru'})
        print('Telegram configuration OK. Bot: @'+me['username'])
    except AppError as error:
        raise SystemExit('External service check failed: '+error.code) from None


if __name__=='__main__':main()
