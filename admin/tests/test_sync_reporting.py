"""A phone event becomes an admin report, and an admin repair reaches the phone log."""
from sqlmodel import Session, select

from app.core.sqltypes import utcnow
from app.sync.store import NewEvent, append, since
from app.tasks.models import Task
from hearth_admin import actions, analytics, queries


def test_phone_to_admin_to_phone(engine):
    with Session(engine) as s:
        now = utcnow()
        append(s, household_id='h_home', member_id='m_mom', stream='tasks', events=[
            NewEvent('ev_phone_task_1', now, {'type': 'ADD_TASK', 'by': 'm_mom', 'task': {
                'title': 'Fix leaking tap', 'section': 'Home Repair', 'kind': 'task',
                'whoId': 'm_dad', 'due': None, 'notes': '', 'details': {}}})])
        s.commit()
        task = s.exec(select(Task).where(Task.household_id == 'h_home')).one()
        assert analytics.overview(s, now)['open_tasks'] == 1
        assert queries.tasks(s, now)[0]['title'] == 'Fix leaking tap'
        actions.set_task_status(s, 'Admin', task.id, 'done', 'Fixed', now)
        s.commit()
        assert analytics.overview(s, now)['open_tasks'] == 0
        events = since(s, household_id='h_home', stream='tasks', after=0)
        assert events[-1].body['type'] == 'ADMIN_PATCH_TASK'
        assert events[-1].body['patch']['done'] is True
        actions.assign_task(s, 'Admin', task.id, 'm_me', 'Reassign', now)
        s.commit()
        events = since(s, household_id='h_home', stream='tasks', after=0)
        assert events[-1].body['patch']['whoId'] == 'm_me'
        actions.set_task_status(s, 'Admin', task.id, 'cancelled', 'Duplicate', now)
        s.commit()
        assert since(s, household_id='h_home', stream='tasks', after=0)[-1].body['type'] == 'REMOVE_TASK'
        actions.set_task_status(s, 'Admin', task.id, 'open', 'Reopen', now)
        s.commit()
        assert analytics.overview(s, now)['open_tasks'] == 1
        assert since(s, household_id='h_home', stream='tasks', after=0)[-1].body['task']['title'] == 'Fix leaking tap'


def test_profile_ids_are_mapped_for_reports_and_admin_assignment(engine):
    from app.core.models import Member
    with Session(engine) as s:
        mom, dad = s.get(Member, 'm_mom'), s.get(Member, 'm_dad')
        mom.phone, dad.phone = '+919876543210', '+919811112222'
        s.add(mom)
        s.add(dad)
        now = utcnow()
        # Phone ids are family profile ids, distinct from API account ids.
        append(s, household_id='h_home', member_id='m_mom', stream='tasks', events=[
            NewEvent('ev_local_task_1', now, {'type': 'ADD_TASK', 'by': 'local_mom', 'task': {
                'title': 'Pay bill', 'section': 'Bills & Payments', 'kind': 'bill',
                'whoId': 'local_dad', 'due': None, 'notes': '', 'details': {}}})])
        s.commit()
        # Profile can arrive after the task; reports must refresh when identities link.
        append(s, household_id='h_home', member_id='m_mom', stream='profile', events=[
            NewEvent('ev_profile_link', now, {'type': 'HYDRATE', 'payload': {'members': [
                {'id': 'local_mom', 'phone': mom.phone}, {'id': 'local_dad', 'phone': dad.phone}]}})])
        s.commit()
        task = s.exec(select(Task).where(Task.household_id == 'h_home')).one()
        assert task.created_by_member_id == 'm_mom'
        assert task.assigned_to_member_id == 'm_dad'
        actions.assign_task(s, 'Admin', task.id, 'm_mom', 'Change assignee', now)
        s.commit()
        assert since(s, household_id='h_home', stream='tasks', after=0)[-1].body['patch']['whoId'] == 'local_mom'
