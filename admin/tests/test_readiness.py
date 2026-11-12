"""Release regressions: complete paging, live stock/bills, and trustworthy admin identity."""
import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.sqltypes import utcnow
from app.reporting.models import ReportState
from app.tasks.models import Task
from hearth_admin import db, queries
from hearth_admin.main import app


@pytest.fixture()
def client(engine, monkeypatch):
    monkeypatch.setenv('ADMIN_TOKEN', 'local-test')
    db.set_engine(engine)
    with TestClient(app, headers={'Authorization': 'Bearer local-test'}) as client:
        yield client
    db.set_engine(None)


def test_overdue_filter_precedes_limit_and_pages_stably(engine, client):
    now = utcnow()
    with Session(engine) as s:
        for ident, due, updated in [
            ('recent', now + timedelta(days=1), now),
            ('old-a', now - timedelta(days=2), now - timedelta(days=1)),
            ('old-b', now - timedelta(days=2), now - timedelta(days=1)),
        ]:
            s.add(Task(id=ident, household_id='h_home', title=ident, category='Home Repair',
                       created_by_member_id='m_mom', due_at=due, updated_at=updated))
        s.commit()
    first = client.get('/api/tasks?overdue=true&limit=1').json()
    second = client.get('/api/tasks?overdue=true&limit=1&offset=1').json()
    assert [first[0]['id'], second[0]['id']] == ['old-a', 'old-b']
    assert client.get('/api/tasks?overdue=true&limit=1&offset=2').json() == []
    assert client.get('/api/tasks?offset=-1').status_code == 422
    assert client.get('/api/posts?limit=301').status_code == 422


def test_synced_pantry_and_app_bills_are_visible_and_isolated(engine, client):
    with Session(engine) as s:
        s.add(ReportState(household_id='h_home', stream='grocery', state={
            'products': [{'id': 'rice', 'name': 'Rice'}],
            'inventory': [{'productId': 'rice', 'state': 'running_low',
                           'approxQty': 2, 'approxUnit': 'kg', 'updatedAt': '2026-11-12T00:00:00Z'}],
        }))
        s.add(Task(id='bill', household_id='h_home', title='Electricity',
                   created_by_member_id='m_mom', category='Bills & Payments'))
        s.add(Task(id='repair', household_id='h_home', title='Tap',
                   created_by_member_id='m_mom', category='Home Repair'))
        s.commit()
        assert queries.pantry(s, 'another-home') == []
    family = client.get('/api/families/h_home').json()
    assert family['pantry'][0]['product'] == 'Rice'
    assert family['pantry'][0]['qty'] == 2
    assert [t['id'] for t in family['mobile_bills']] == ['bill']


def test_family_and_global_pagination_reaches_old_records(engine, client):
    with Session(engine) as s:
        for n in range(55):
            s.add(Task(id=f't{n:03}', household_id='h_home', title=f'Task {n}', category='Home Repair',
                       created_by_member_id='m_mom'))
        s.commit()
    first = client.get('/api/families/h_home?limit=50').json()['tasks']
    second = client.get('/api/families/h_home?limit=50&offset=50').json()['tasks']
    assert len(first) == 50 and len(second) == 5
    assert len({t['id'] for t in first + second}) == 55


def test_named_credentials_override_claimed_identity_and_are_revocable(client, monkeypatch):
    token = 'a' * 64
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.setenv('ADMIN_TOKENS', json.dumps({'Priya': token, 'Ravi': 'b' * 64}))
    headers = {'Authorization': 'Bearer ' + token, 'X-Admin-Name': 'Impersonator'}
    assert client.get('/api/me', headers=headers).json() == {'admin': 'Priya'}
    assert client.post('/api/families/h_home/status', headers=headers,
                       json={'status': 'under_review', 'note': 'Review'}).status_code == 200
    response = client.get('/api/audit', headers=headers)
    assert response.json()[0]['admin'] == 'Priya'
    assert response.headers['cache-control'] == 'no-store'
    monkeypatch.setenv('ADMIN_TOKENS', json.dumps({'Ravi': 'b' * 64}))
    assert client.get('/api/me', headers=headers).status_code == 401
    assert client.get('/api/me').status_code == 401  # shared legacy token refused
    monkeypatch.delenv('ADMIN_TOKENS')
    assert client.get('/api/me').status_code == 503


@pytest.mark.parametrize('value', ['{}', '[]', 'bad json', '{"a":"short"}',
                                    json.dumps({'a': 'x' * 32, 'b': 'x' * 32})])
def test_bad_operator_configuration_fails_closed(client, monkeypatch, value):
    monkeypatch.setenv('ADMIN_TOKENS', value)
    assert client.get('/api/me').status_code == 503


def test_console_templates_render_api_data(client, engine):
    import subprocess
    from pathlib import Path

    with Session(engine) as s:
        s.add(ReportState(household_id='h_home', stream='grocery', state={
            'products': [{'id': 'rice', 'name': 'Rice'}],
            'inventory': [{'productId': 'rice', 'state': 'out', 'updatedAt': None}],
        }))
        s.add(Task(id='bill', household_id='h_home', title='Electricity',
                   created_by_member_id='m_mom', category='Bills & Payments'))
        s.commit()
    responses = {path: client.get(path).json() for path in [
        '/api/families/h_home', '/api/families', '/api/tasks', '/api/posts', '/api/audit',
    ]}
    admin = Path(__file__).resolve().parents[1]
    result = subprocess.run(['node', str(admin / 'tests/render-console.cjs')], input=json.dumps({
        'script': str(admin / 'hearth_admin/static/app.js'), 'responses': responses,
    }), text=True, capture_output=True, check=False)
    assert result.returncode == 0, result.stderr


def test_production_startup_requires_database_secret_and_named_credentials(monkeypatch):
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.setenv('DATABASE_URL', 'postgresql://example.invalid/hearth')
    monkeypatch.setenv('AUTH_SECRET', 'x' * 64)
    monkeypatch.delenv('ADMIN_TOKENS', raising=False)
    with pytest.raises(RuntimeError, match='ADMIN_TOKENS'), TestClient(app):
        pass
    monkeypatch.setenv('ADMIN_TOKENS', json.dumps({'Priya': 'a' * 64}))
    monkeypatch.setenv('AUTH_SECRET', 'short')
    with pytest.raises(RuntimeError, match='AUTH_SECRET'), TestClient(app):
        pass
    monkeypatch.setenv('AUTH_SECRET', 'x' * 64)
    with TestClient(app):
        pass  # Startup validation does not open a database connection.


def test_posts_and_audit_pages_do_not_repeat_rows(demo):
    from hearth_admin.actions import set_household_status

    with Session(demo) as s:
        now = utcnow()
        for status in ['under_review', 'active', 'under_review']:
            set_household_status(s, 'Priya', 'h_home', status, 'Review', now)
        s.commit()
        for read in [lambda offset: queries.posts(s, offset=offset, limit=1),
                     lambda offset: queries.audit(s, offset=offset, limit=1)]:
            pages = [read(n) for n in range(3)]
            assert all(len(page) == 1 for page in pages)
            assert len({page[0]['id'] for page in pages}) == 3
