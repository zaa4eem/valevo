from pathlib import Path
STATIC = Path(__file__).parents[1] / 'webapp' / 'static'
def test_live_booking_contract():
    js = (STATIC / 'js/app.js').read_text(encoding='utf-8')
    for text in ['/api/booking/options', '/api/booking/availability', '/api/bookings', 'idempotency_key', 'place_keys', 'duration_minutes', 'is_super_admin']:
        assert text in js
    assert 'role-select' not in js

def test_auth_names_and_failure_states():
    js = (STATIC / 'js/app.js').read_text(encoding='utf-8')
    for text in ['Общий зачёт', 'Карточка пилота', 'initData', 'Authorization', 'Повторить', 'Открыть бота']:
        assert text in js
    assert 'const ledger=' not in js

def test_finance_uses_server_integer_money():
    js = (STATIC / 'js/app.js').read_text(encoding='utf-8')
    for text in ['/api/admin/finance', 'turnover_kopecks', 'commission_kopecks', 'date_from']:
        assert text in js

def test_implemented_operations_have_live_screens():
    js = (STATIC / 'js/app.js').read_text(encoding='utf-8')
    for endpoint in ['/api/results', '/api/super/pilots', '/api/super/tracks', '/api/super/benchmarks']:
        assert endpoint in js

def test_booking_status_actions_and_refund_chart():
    js = (STATIC / 'js/app.js').read_text(encoding='utf-8')
    assert "b.status==='pending_admin'" in js
    assert 'reconciliation_required' in js
    assert 'negative' in js

# Local-only browser fixture. Never imports the application, bot, or real database.
if __name__ == '__main__':
    import json
    import os
    from http.server import BaseHTTPRequestHandler, HTTPServer
    class Fixture(BaseHTTPRequestHandler):
        def do_GET(self):
            path = self.path.split('?')[0]
            profile = dict(display_name='Тестовый пилот', pilot_number=42, rating=640, current_class='GT3')
            routes = {
                '/api/me': dict(registered=True, is_admin=True, is_super_admin=True, profile=profile),
                '/api/booking/options': dict(places=[dict(key=f'{kind}_{i}', title=f'{title} №{i+offset}', type=kind, hourly_rate_kopecks=rate) for kind,title,count,offset,rate in [('static','Статика',4,2,70000),('motion','Подвижка',2,0,100000)] for i in range(1,count+1)], durations=[30,60,90,120,180],days_ahead=14,timezone='Europe/Moscow',open_hour=12,close_hour=24),
                '/api/booking/availability': dict(places=[dict(key=f'{kind}_{i}',available=(kind,i)!=('static',3)) for kind,count in [('static',4),('motion',2)] for i in range(1,count+1)]),
                '/api/bookings': dict(bookings=[]),
                '/api/admin/bookings': dict(bookings=[]),
                '/api/leaderboard': dict(overall=[],disciplines=[]),
                '/api/disciplines': dict(disciplines=[dict(name='GT3',tracks=['Monza'])],benchmarks={},month_key='2026-09'),
                '/api/super/pilots': dict(pilots=[profile]),
                '/api/results': dict(total_results=1,podiums=0,gold=0,silver=0,bronze=0,last_result=None,disciplines_count=1),
                '/api/admin/finance': dict(turnover_kopecks=300000,commission_kopecks=30000,club_kopecks=270000,booking_count=1,hours=3,daily=[dict(date='2026-09-13',turnover_kopecks=300000)]),
            }
            if path in routes:
                payload=json.dumps(routes[path]).encode();mime='application/json'
            else:
                name='index.html' if path=='/' else path.removeprefix('/assets/')
                file=(STATIC/name).resolve()
                if not file.is_relative_to(STATIC.resolve()) or not file.is_file():
                    self.send_error(404);return
                payload=file.read_bytes();mime='text/css' if file.suffix=='.css' else 'text/javascript' if file.suffix=='.js' else 'text/html'
            self.send_response(200);self.send_header('Content-Type',mime+'; charset=utf-8');self.end_headers();self.wfile.write(payload)
        def do_POST(self):
            self.rfile.read(int(self.headers.get('Content-Length',0)))
            self.send_response(409);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'error':'Тестовая ошибка: заявка не создана'}).encode())
    HTTPServer(('127.0.0.1', int(os.getenv('VALEVO_FIXTURE_PORT','8766'))),Fixture).serve_forever()

def test_runtime_timezone_refunds_auth_and_role_guard():
    import json
    import shutil
    import subprocess
    import pytest
    node = shutil.which('node')
    if not node:
        pytest.skip('Node is required for frontend runtime contract')
    source = (STATIC / 'js/app.js').read_text(encoding='utf-8')
    source = source.rsplit('start();', 1)[0]
    script = """
const assert=require('node:assert/strict');
global.window={Telegram:{WebApp:{initData:'signed-test-data',ready:()=>{},expand:()=>{}}}};
global.document={querySelector:()=>({}),querySelectorAll:()=>[]};
""" + source + """
assert.equal(instant('2026-09-13','18:00','Europe/Moscow'),'2026-09-13T15:00:00.000Z');
assert.equal(instant('2026-09-13','18:00','Asia/Yekaterinburg'),'2026-09-13T13:00:00.000Z');
assert.match(chart([{date:'2026-09-13',turnover_kopecks:-10000}]),/y="85"/);
assert.match(chart([{date:'2026-09-13',turnover_kopecks:-10000}]),/height="55"/);
me={is_admin:true,is_super_admin:false};
assert.throws(requireSuper,/Недостаточно прав/);
me={is_super_admin:true};requireSuper();
let captured;
global.fetch=async(path,options)=>{captured=options;return {ok:true,json:async()=>({ok:true})};};
(async()=>{await api('/api/me');assert.equal(captured.headers.Authorization,'tma signed-test-data');
global.fetch=async()=>({ok:false,status:409,json:async()=>({error:'slot busy'})});
await assert.rejects(api('/api/bookings'),/slot busy/);})().catch(e=>{console.error(e);process.exitCode=1;});
"""
    run = subprocess.run([node, '-e', script], capture_output=True, text=True, encoding='utf-8')
    assert run.returncode == 0, run.stderr



def test_no_payment_or_refund_operations_in_ui():
    js = (STATIC / 'js/app.js').read_text(encoding='utf-8')
    assert '/api/admin/finance/events' not in js
    assert 'balance_kopecks' not in js
    assert 'async function payments' not in js
    assert 'Стоимость подтверждённых броней' in js
