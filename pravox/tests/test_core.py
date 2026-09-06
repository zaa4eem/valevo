import hashlib
import hmac
import io
import json
import tempfile
import os
import sqlite3
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from urllib.parse import urlencode

from app.ai import Answer, allowed_source, parse_response
from app.auth import validate_init_data
from app.bot import Bot
from app.config import Config
from app.db import Database
from app.errors import AppError, UpstreamError
from app.service import Service
from app.stats import summary,csv_export
from app.telegram import split_message, Telegram
from app.web import WebApplication

TOKEN='123456:test-only-token'


def signed(user_id=17, now=None, extra=None):
    data={'auth_date':str(int(now or time.time())),'query_id':'test',
          'user':json.dumps({'id':user_id,'first_name':'Анна'},ensure_ascii=False,separators=(',',':'))}
    data.update(extra or {})
    secret=hmac.new(b'WebAppData',TOKEN.encode(),hashlib.sha256).digest()
    data['hash']=hmac.new(secret,'\n'.join(f'{k}={v}' for k,v in sorted(data.items())).encode(),hashlib.sha256).hexdigest()
    return urlencode(data)


class FakeTelegram:
    def __init__(self):self.members=set();self.fail=False;self.sent=[];self.documents=[];self.checks=0
    def membership(self,uid):
        self.checks+=1
        if self.fail:raise UpstreamError()
        return uid in self.members,'member' if uid in self.members else 'left'
    def send(self,uid,text,keyboard=None):self.sent.append((uid,text,keyboard));return {}
    def send_document(self,uid,filename,content):self.documents.append((uid,filename,content));return {}
    def call(self,*args,**kwargs):return {}
    def menu_keyboard(self,*args):return []
    def gate_keyboard(self):return []


class FakeAI:
    def __init__(self):self.fail=False;self.history=[];self.kind='answer'
    def answer(self,question,mode,history):
        self.history=history
        if self.fail:raise UpstreamError('sources_unconfirmed')
        return Answer('Проверенный ответ [1]',[{'url':'https://pravo.gov.ru/','title':'Норма'}],self.kind,100,50,1)


class AuthTests(unittest.TestCase):
    def test_valid_signature_and_user(self):self.assertEqual(validate_init_data(signed(),TOKEN)['id'],17)
    def test_forged_id(self):
        raw=signed().replace('%3A17','%3A18')
        with self.assertRaises(AppError):validate_init_data(raw,TOKEN)
    def test_expired(self):
        with self.assertRaises(AppError):validate_init_data(signed(now=time.time()-4000),TOKEN)
    def test_future(self):
        with self.assertRaises(AppError):validate_init_data(signed(now=time.time()+4000),TOKEN)
    def test_duplicate_params(self):
        with self.assertRaises(AppError):validate_init_data(signed()+'&user=anything',TOKEN)
    def test_wrong_token(self):
        with self.assertRaises(AppError):validate_init_data(signed(),'wrong')
    def test_signature_field_included_in_hmac(self):self.assertEqual(validate_init_data(signed(extra={'signature':'third-party-signature'}),TOKEN)['id'],17)
    def test_missing(self):
        with self.assertRaises(AppError):validate_init_data('',TOKEN)


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.config=Config(db_path=self.tmp.name+'/test.sqlite',bot_token=TOKEN,ai_key='test',ai_model='test',public_url='https://example.org',requests_per_minute=100)
        self.db=Database(self.config.db_path);self.tg=FakeTelegram();self.ai=FakeAI();self.s=Service(self.config,self.db,self.tg,self.ai);self.app=WebApplication(self.s)
        self.register(17);self.register(18);self.register(self.config.admin_id)
    def tearDown(self):self.tmp.cleanup()
    def register(self,uid):
        self.db.register({'id':uid,'first_name':'Анна','username':'anna'})
        self.db.execute('UPDATE users SET consent=? WHERE id=?',(time.time(),uid))
    def ask(self,i=0,uid=17,surface='miniapp'):
        job=self.s.submit(uid,'Вопрос '+str(i),'req'+str(i),surface);self.s.process_one();return job
    def assertCode(self,code,call):
        with self.assertRaises(AppError) as result:call()
        self.assertEqual(result.exception.code,code)
    def request(self,path,uid=17,method='GET',data=None,auth=True,origin=None):
        raw=json.dumps(data).encode() if data is not None else b''
        base,_,query=path.partition('?')
        env={'PATH_INFO':base,'QUERY_STRING':query,'REQUEST_METHOD':method,'CONTENT_LENGTH':str(len(raw)),'CONTENT_TYPE':'application/json','wsgi.input':io.BytesIO(raw)}
        if auth:env['HTTP_AUTHORIZATION']='tma '+signed(uid)
        if origin:env['HTTP_ORIGIN']=origin
        status=[];headers=[]
        payload=b''.join(self.app(env,lambda s,h:(status.append(s),headers.extend(h))))
        return int(status[0].split()[0]),json.loads(payload) if dict(headers)['Content-Type'].startswith('application/json') else payload,dict(headers)
    def test_three_free_then_gate(self):
        for i in range(3):self.ask(i)
        self.assertEqual(self.s.user(17)['used'],3)
        self.assertCode('subscription_required',lambda:self.s.submit(17,'Четвёртый','r4','miniapp'))
        self.assertEqual(self.db.one('SELECT count(*) n FROM jobs')['n'],3)
    def test_subscription_then_unsubscription(self):
        for i in range(3):self.ask(i)
        self.tg.members.add(17);self.ask(4)
        self.tg.members.clear()
        self.assertCode('subscription_required',lambda:self.s.submit(17,'Пятый','r5','telegram'))
        self.assertEqual(self.s.user(17)['used'],4)
    def test_membership_outage_fails_closed(self):
        for i in range(3):self.ask(i)
        self.tg.fail=True
        self.assertCode('upstream_unavailable',lambda:self.s.submit(17,'Четвёртый','r4','telegram'))
        self.assertEqual(self.s.user(17)['used'],3)
    def test_failed_ai_does_not_charge(self):
        self.ai.fail=True;job=self.ask()
        self.assertEqual(self.s.user(17)['used'],0)
        self.assertEqual(self.s.get_job(17,job['id'])['state'],'failed')
        self.assertEqual(self.s.history(17,job['conversation_id'])[0]['job_state'],'failed')
    def test_shared_counter(self):
        self.ask(0,surface='telegram');self.ask(1);self.ask(2,surface='telegram')
        self.assertCode('subscription_required',lambda:self.s.submit(17,'Четвёртый','r4','miniapp'))
    def test_shared_context(self):
        self.ask(0,surface='telegram');self.ask(1)
        self.assertEqual(len(self.ai.history),2)
        self.assertEqual(self.ai.history[0]['text'],'Вопрос 0')
        messages=self.s.history(17,self.s.user(17)['active_conversation'])
        self.assertEqual([m['surface'] for m in messages],['telegram','telegram','miniapp','miniapp'])
    def test_replay_is_idempotent(self):
        first=self.ask(0);again=self.s.submit(17,'Вопрос 0','req0','miniapp')
        self.assertEqual(first['id'],again['id']);self.assertEqual(self.s.user(17)['used'],1)
        self.assertEqual(self.db.one('SELECT count(*) n FROM jobs')['n'],1)
    def test_replay_with_other_body_rejected(self):
        self.ask();self.assertCode('idempotency_conflict',lambda:self.s.submit(17,'Другой вопрос','req0','miniapp'))
    def test_idempotency_scoped_to_user(self):
        self.ask();self.ask(uid=18);self.assertEqual(self.db.one('SELECT count(*) n FROM jobs')['n'],2)
    def test_atomic_concurrent_submissions(self):
        def submit(i):
            try:return self.s.submit(17,'Вопрос',f'parallel{i}','miniapp')['id']
            except AppError as e:return e.code
        with ThreadPoolExecutor(max_workers=8) as pool:values=list(pool.map(submit,range(8)))
        self.assertEqual(values.count('busy'),7)
        self.assertEqual(self.db.one("SELECT count(*) n FROM jobs WHERE state='queued'")['n'],1)
    def test_admin_bypasses_gate(self):
        for i in range(5):self.ask(i,uid=self.config.admin_id)
        self.assertEqual(self.tg.checks,0)
    def test_cross_user_history_and_job_denied(self):
        job=self.ask()
        self.assertCode('not_found',lambda:self.s.history(18,job['conversation_id']))
        self.assertCode('not_found',lambda:self.s.get_job(18,job['id']))
        self.assertCode('not_found',lambda:self.s.activate(18,job['conversation_id']))
    def test_cannot_append_to_others_conversation(self):
        job=self.ask();self.assertCode('not_found',lambda:self.s.submit(18,'Вопрос','other','miniapp',job['conversation_id']))
    def test_new_conversation_preserves_old(self):
        job=self.ask();new=self.s.new_conversation(17,'student')
        self.assertNotEqual(job['conversation_id'],new);self.assertEqual(len(self.s.history(17,job['conversation_id'])),2)
    def test_busy_prevents_delete_and_switch(self):
        self.s.submit(17,'Вопрос','busy','miniapp')
        self.assertCode('busy',lambda:self.s.clear_history(17))
        self.assertCode('busy',lambda:self.s.new_conversation(17,'student'))
    def test_delete_scrubs_content_but_retains_usage(self):
        self.ask(surface='telegram');self.s.clear_history(17)
        self.assertEqual(self.db.one('SELECT count(*) n FROM messages')['n'],0)
        self.assertEqual(self.db.one('SELECT count(*) n FROM outbox')['n'],0)
        self.assertEqual(self.db.one('SELECT question FROM jobs')['question'],'')
        self.assertEqual(self.s.user(17)['used'],1)
    def test_consent_required(self):
        self.db.execute('UPDATE users SET consent=NULL WHERE id=17')
        self.assertCode('consent_required',lambda:self.s.submit(17,'Вопрос','req','miniapp'))
    def test_out_of_scope_not_charged(self):
        self.ai.kind='out_of_scope';self.ask();self.assertEqual(self.s.user(17)['used'],0)
    def test_feedback_ownership(self):
        self.ask();message=self.db.one("SELECT id FROM messages WHERE role='assistant'")
        self.assertCode('not_found',lambda:self.s.feedback(18,message['id'],1))
        self.s.feedback(17,message['id'],-1)
        self.assertEqual(self.db.one('SELECT feedback FROM messages WHERE id=?',(message['id'],))['feedback'],-1)
    def test_admin_api_denies_non_admin(self):
        for route in ['/api/admin/stats','/api/admin/users','/api/admin/export.csv']:
            self.assertEqual(self.request(route)[0],403)
        self.assertEqual(self.request('/api/admin/export-to-telegram',method='POST',data={'kind':'users'})[0],403)
        self.assertFalse(self.tg.documents)
    def test_admin_api_and_csv(self):
        self.ask();uid=self.config.admin_id
        self.assertEqual(self.request('/api/admin/stats',uid=uid)[1]['completed'],1)
        result=self.request('/api/admin/export-to-telegram',uid=uid,method='POST',data={'kind':'daily'})
        self.assertEqual(result[0],200);self.assertEqual(self.tg.documents[0][0],uid)
    def test_no_client_user_id_trust(self):
        result=self.request('/api/ask',method='POST',data={'question':'Вопрос','client_id':'one','user_id':self.config.admin_id})
        self.assertEqual(result[0],202);self.assertEqual(self.db.one('SELECT user_id FROM jobs')['user_id'],17)
    def test_api_denies_missing_auth_and_other_origin(self):
        self.assertEqual(self.request('/api/me',auth=False)[0],401)
        self.assertEqual(self.request('/api/consent',method='POST',data={'accepted':True},origin='https://evil.example')[0],403)
    def test_static_and_public_do_not_leak_secret(self):
        for route in ['/app','/assets/app.js','/api/public']:
            status,body,headers=self.request(route,auth=False)
            self.assertEqual(status,200);self.assertNotIn(TOKEN,str(body));self.assertIn('Content-Security-Policy',headers)
        self.assertEqual(self.request('/assets/../.env',auth=False)[0],404)
    def test_statistics_numbers_and_days(self):
        self.ask(0);self.ai.fail=True;self.ask(1)
        report=summary(self.db,self.config,7)
        self.assertEqual((report['requests'],report['completed'],report['failed']),(2,1,1))
        self.assertEqual(len(report['daily']),7);self.assertEqual(sum(d['requests'] for d in report['daily']),2)
    def test_bot_commands_not_counted_and_groups_ignored(self):
        bot=Bot(self.s)
        bot.handle({'update_id':1,'message':{'chat':{'id':17,'type':'private'},'from':{'id':17,'first_name':'Анна'},'text':'/start'}})
        bot.handle({'update_id':2,'message':{'chat':{'id':-1,'type':'group'},'from':{'id':17},'text':'Вопрос'}})
        self.assertEqual(self.s.user(17)['used'],0);self.assertEqual(self.db.one('SELECT count(*) n FROM jobs')['n'],0)
    def test_outbox_is_only_for_chat(self):
        self.ask();self.assertEqual(self.db.one('SELECT count(*) n FROM outbox')['n'],0)
        self.ask(1,surface='telegram');self.assertGreater(self.db.one('SELECT count(*) n FROM outbox')['n'],0)
        Bot(self.s).deliver_one();self.assertIsNotNone(self.db.one('SELECT delivered FROM outbox')['delivered'])
    def test_missing_ai_does_not_charge(self):
        s=Service(replace(self.config,ai_key=''),self.db,self.tg,self.ai)
        self.assertCode('ai_not_configured',lambda:s.submit(17,'Вопрос','x','miniapp'))
    def use_subpath(self):
        self.config=replace(self.config,public_url='https://zaa4eem.ru/pravoXru')
        self.s.config=self.config;self.app=WebApplication(self.s)
    def test_subpath_html_and_assets(self):
        self.use_subpath()
        status,body,_=self.request('/pravoXru/',auth=False)
        self.assertEqual(status,200)
        self.assertIn(b'data-base-path="/pravoXru"',body)
        self.assertIn(b'/pravoXru/assets/app.js',body)
        self.assertNotIn(b'__BASE_PATH__',body)
        self.assertEqual(self.request('/pravoXru/assets/app.js',auth=False)[0],200)
        self.assertEqual(self.request('/assets/app.js',auth=False)[0],404)
    def test_subpath_api_and_origin(self):
        self.use_subpath()
        result=self.request('/pravoXru/api/ask',method='POST',data={'question':'Вопрос','client_id':'path'},origin='https://zaa4eem.ru')
        self.assertEqual(result[0],202)
        self.assertEqual(self.request('/pravoXru/api/me')[0],200)
        self.assertEqual(self.request('/api/me')[0],404)
    def test_subpath_health_and_config(self):
        self.use_subpath()
        self.assertEqual(self.config.validate(),[])
        self.assertEqual(self.request('/healthz',auth=False)[0],200)
        self.assertEqual(self.request('/pravoXru/healthz',auth=False)[0],200)
        self.assertEqual(self.request('/pravoXru/other',auth=False)[0],404)
    def test_subpath_bot_menu(self):
        self.use_subpath()
        menu=Telegram(self.config).menu_keyboard(True)
        self.assertEqual(menu[0][0]['web_app']['url'],'https://zaa4eem.ru/pravoXru/')
        self.assertEqual(menu[-1][0]['web_app']['url'],'https://zaa4eem.ru/pravoXru/#admin')
    def test_backup_is_consistent_and_private(self):
        self.ask();path=self.db.backup(self.tmp.name+'/backups')
        with sqlite3.connect(path) as db:self.assertEqual(db.execute('SELECT count(*) FROM jobs').fetchone()[0],1)
        self.assertEqual(os.stat(path).st_mode&0o777,0o600)
        self.assertEqual(self.db.backup(self.tmp.name+'/backups'),path)
    def test_config_repr_does_not_expose_secrets(self):
        config=replace(self.config,ai_key='sensitive-ai-key')
        self.assertNotIn('sensitive-ai-key',repr(config));self.assertNotIn(TOKEN,repr(config))


class ProviderTests(unittest.TestCase):
    def response(self,url='https://pravo.gov.ru/test',with_search=True):
        text='[[ANSWER]]\nВывод cite'
        outputs=[{'type':'web_search_call'}] if with_search else []
        outputs.append({'type':'message','role':'assistant','content':[{'type':'output_text','text':text,'annotations':[{'type':'url_citation','url':url,'title':'Норма','start_index':text.index('cite'),'end_index':len(text)}]}]})
        return {'status':'completed','output':outputs,'usage':{'input_tokens':100,'output_tokens':20}}
    def test_verified_citations(self):
        answer=parse_response(self.response());self.assertEqual(answer.text,'Вывод [1]');self.assertEqual(answer.input_tokens,100)
    def test_no_search_rejected(self):
        with self.assertRaises(UpstreamError):parse_response(self.response(with_search=False))
    def test_fake_domain_rejected(self):
        for url in ['https://pravo.gov.ru.evil.example/','https://pravo.gov.ru@evil.example/','javascript:alert(1)']:
            self.assertFalse(allowed_source(url))
            with self.assertRaises(UpstreamError):parse_response(self.response(url))
    def test_clarification_does_not_require_citation(self):
        data={'status':'completed','output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':'[[CLARIFY]]\nВ каком регионе произошли события?'}]}]}
        self.assertEqual(parse_response(data).kind,'clarify')
    def test_incomplete_rejected(self):
        data=self.response();data['status']='incomplete'
        with self.assertRaises(UpstreamError):parse_response(data)
    def test_unicode_telegram_split(self):
        text='А😀'*3000;chunks=split_message(text)
        self.assertEqual(''.join(chunks),text)
        self.assertTrue(all(len(c.encode('utf-16-le'))//2<=3500 for c in chunks))
    def test_csv_formula_injection(self):
        data=csv_export([{'name':'=HYPERLINK("bad")','id':17},{'name':'  +SUM(1)','id':18}]).decode()
        self.assertIn("'=HYPERLINK",data);self.assertIn("'  +SUM",data)


if __name__=='__main__':unittest.main()
