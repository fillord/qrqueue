from datetime import datetime, timedelta
import base64
from io import BytesIO
from zoneinfo import ZoneInfo

import cv2
import numpy as np
from openpyxl import Workbook
from sqlalchemy import select

from app.api import attendance as attendance_api
from app.clock import utcnow
from app.models.attendance import AttendanceEvent, Employee
from app.models.department import Department
from app.models.enums import UserRole
from app.services.attendance import qr_token, verify_qr
from app.services.errors import ServiceError
from app.services.face_attendance import decode_template, encode_template, face_descriptor
from app.services import face_attendance
from tests.utils import login

TEST_FRAMES = ['a' * 1000, 'b' * 1000]
def phone_capture_payload(session, code):
    return {'token': session, 'code': code, 'images': TEST_FRAMES}


def kiosk_capture_payload():
    return {'images': TEST_FRAMES}


async def pair_kiosk(client, name='Регистратура'):
    created = await client.post('/api/attendance/admin/kiosks', json={'name': name})
    assert created.status_code == 201, created.text
    code = created.json()['pairing_code']
    paired = await client.post('/api/attendance/kiosk/pair', json={'code': code})
    assert paired.status_code == 200, paired.text
    return created.json()['id'], {'X-Kiosk-Token': paired.json()['device_token']}


def employee_workbook(rows: list[tuple[str, str, str]]) -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = 'Сотрудники'
    sheet.append(['ФИО', 'Отделение', 'Должность'])
    for row in rows:
        sheet.append(list(row))
    output = BytesIO()
    book.save(output)
    return output.getvalue()


def test_attendance_qr_expires_and_rejects_tampering():
    import uuid
    org_id = uuid.uuid4()
    token = qr_token(org_id)
    assert verify_qr(token) == org_id
    try:
        verify_qr(token[:-1] + ('0' if token[-1] != '0' else '1'))
        assert False, 'tampered QR accepted'
    except ServiceError as error:
        assert error.code == 'attendance_qr_expired'


def test_face_models_reject_blank_image_and_encrypt_descriptors():
    vector = np.zeros(128, dtype=np.float32)
    vector[0] = 1
    sealed = encode_template(vector)
    assert sealed != vector.tobytes()
    assert np.array_equal(decode_template(sealed), vector)
    _, jpeg = cv2.imencode('.jpg', np.full((400, 400, 3), 240, dtype=np.uint8))
    try:
        face_descriptor(base64.b64encode(jpeg.tobytes()).decode())
        assert False, 'blank image accepted'
    except ServiceError as error:
        assert error.code == 'face_count_invalid'


def test_face_capture_checks_consistency_without_movement(monkeypatch):
    vector = np.zeros(128, dtype=np.float32)
    vector[0] = 1
    monkeypatch.setattr(face_attendance, 'face_descriptor', lambda image: vector)
    assert np.array_equal(face_attendance.capture_descriptor(TEST_FRAMES), vector)
    different = np.zeros(128, dtype=np.float32)
    different[1] = 1
    monkeypatch.setattr(face_attendance, 'face_descriptor', lambda image: vector if image == TEST_FRAMES[0] else different)
    try:
        face_attendance.capture_descriptor(TEST_FRAMES)
        assert False, 'different faces accepted'
    except ServiceError as error:
        assert error.code == 'face_capture_inconsistent'


async def test_admin_scoping_enrollment_and_phone_marks(client, db_session, make_user, make_organization, monkeypatch):
    org_a = await make_organization(name='Attendance A')
    org_b = await make_organization(name='Attendance B')
    admin_a, password_a = await make_user(email='attendance-a@example.com', role=UserRole.org_admin, organization_id=org_a.id)
    admin_b, password_b = await make_user(email='attendance-b@example.com', role=UserRole.org_admin, organization_id=org_b.id)
    vector = np.zeros(128, dtype=np.float32)
    vector[0] = 1
    monkeypatch.setattr(attendance_api, 'capture_descriptor', lambda images: vector)
    department = Department(organization_id=org_a.id, name='Therapy')
    db_session.add(department)
    await db_session.commit()
    await login(client, admin_a.email, password_a)

    created = await client.post('/api/attendance/admin/employees', json={'full_name': 'Doctor One', 'department_id': str(department.id), 'position': 'Doctor'})
    assert created.status_code == 201, created.text
    employee_id = created.json()['id']
    code = created.json()['code']
    assert len(code) == 4
    assert 'code' not in (await client.get('/api/attendance/admin/employees')).json()[0]
    assert (await client.post(f'/api/attendance/admin/employees/{employee_id}/face', json={'images': TEST_FRAMES, 'consent_confirmed': False})).status_code == 422
    enrolled = await client.post(f'/api/attendance/admin/employees/{employee_id}/face', json={'images': TEST_FRAMES, 'consent_confirmed': True})
    assert enrolled.status_code == 200 and enrolled.json()['face_enrolled'] is True
    employee = await db_session.get(Employee, employee_id)
    assert employee.face_template != vector.tobytes()

    _, kiosk_headers = await pair_kiosk(client)
    qr = (await client.get('/api/attendance/kiosk/qr', headers=kiosk_headers)).json()['token']
    context = await client.get('/api/attendance/phone/context', params={'token': qr})
    assert context.status_code == 200 and context.json()['organization_name'] == org_a.name
    session = context.json()['session_token']
    payload = phone_capture_payload(session, code)
    first = await client.post('/api/attendance/phone/mark', json=payload)
    assert first.status_code == 200 and first.json()['kind'] == 'in'
    duplicate = await client.post('/api/attendance/phone/mark', json=payload)
    assert duplicate.status_code == 409 and duplicate.json()['detail']['code'] == 'attendance_too_soon'
    detail = duplicate.json()['detail']
    assert detail['last_kind'] == 'in' and detail['employee_name'] == 'Doctor One'
    assert (datetime.fromisoformat(detail['retry_at']) - datetime.fromisoformat(first.json()['occurred_at'])).total_seconds() == 120
    event = (await db_session.scalars(select(AttendanceEvent).where(AttendanceEvent.employee_id == employee.id))).one()
    event.occurred_at = utcnow() - timedelta(minutes=3)
    await db_session.commit()
    payload = phone_capture_payload(session, code)
    second = await client.post('/api/attendance/phone/mark', json=payload)
    assert second.status_code == 200 and second.json()['kind'] == 'out'
    repeated_out = await client.post('/api/attendance/kiosk/mark', json=kiosk_capture_payload(), headers=kiosk_headers)
    assert repeated_out.status_code == 409 and repeated_out.json()['detail']['last_kind'] == 'out'
    manual = await client.post('/api/attendance/admin/events', json={
        'employee_id': employee_id, 'kind': 'out', 'occurred_at': (utcnow() - timedelta(days=1)).isoformat(), 'reason': 'Forgot to mark',
    })
    assert manual.status_code == 201 and manual.json()['source'] == 'manual'
    corrected = await client.patch(f"/api/attendance/admin/events/{manual.json()['id']}", json={
        'kind': 'in', 'occurred_at': (utcnow() - timedelta(days=1, hours=1)).isoformat(), 'reason': 'Corrected type',
    })
    assert corrected.status_code == 200 and corrected.json()['kind'] == 'in'
    previous_local_day = (utcnow() - timedelta(days=1)).astimezone(ZoneInfo(org_a.timezone)).date().isoformat()
    assert len((await client.get('/api/attendance/admin/events', params={'day': previous_local_day})).json()) == 1

    await client.post('/api/auth/logout')
    await login(client, admin_b.email, password_b)
    assert (await client.get('/api/attendance/admin/employees')).json() == []
    assert (await client.get('/api/attendance/admin/events')).json() == []
    assert (await client.delete(f'/api/attendance/admin/employees/{employee_id}')).status_code == 404
    assert (await client.patch(f'/api/attendance/admin/events/{event.id}', json={'kind': 'out', 'occurred_at': utcnow().isoformat(), 'reason': 'Wrong date'})).status_code == 404


async def test_phone_geofence_is_enforced_but_paired_kiosk_still_marks(client, db_session, make_user, make_organization, monkeypatch):
    org = await make_organization(name='Geofenced attendance')
    admin, password = await make_user(email='attendance-geo@example.com', role=UserRole.org_admin, organization_id=org.id)
    vector = np.zeros(128, dtype=np.float32)
    vector[0] = 1
    monkeypatch.setattr(attendance_api, 'capture_descriptor', lambda images: vector)
    employee = Employee(organization_id=org.id, full_name='Nearby worker',
                        code_digest=attendance_api.code_digest(org.id, '1234'),
                        face_template=attendance_api.encode_template(vector), face_consent_at=utcnow())
    db_session.add(employee)
    await db_session.commit()
    await login(client, admin.email, password)

    incomplete = await client.patch('/api/attendance/admin/settings', json={'geo_enabled': True})
    assert incomplete.status_code == 422 and incomplete.json()['detail']['code'] == 'attendance_geo_config_incomplete'
    assert (await client.get('/api/attendance/admin/settings')).json()['geo_enabled'] is False
    response = await client.patch('/api/attendance/admin/settings', json={
        'geo_enabled': True, 'geo_latitude': 43.2389, 'geo_longitude': 76.8897, 'geo_radius_m': 200,
    })
    assert response.status_code == 200, response.text
    assert response.json()['geo_enabled'] is True
    session = attendance_api.phone_session_token(org.id)
    context = await client.get('/api/attendance/phone/context', params={'token': qr_token(org.id)})
    assert context.json()['geo_required'] is True

    payload = phone_capture_payload(session, '1234')
    missing = await client.post('/api/attendance/phone/mark', json=payload)
    assert missing.status_code == 422 and missing.json()['detail']['code'] == 'attendance_geo_required'
    inaccurate = await client.post('/api/attendance/phone/mark', json={
        **payload, 'latitude': 43.2389, 'longitude': 76.8897, 'accuracy_m': 400,
    })
    assert inaccurate.status_code == 422 and inaccurate.json()['detail']['code'] == 'attendance_geo_inaccurate'
    outside = await client.post('/api/attendance/phone/mark', json={
        **payload, 'latitude': 43.2489, 'longitude': 76.8897, 'accuracy_m': 15,
    })
    assert outside.status_code == 403 and outside.json()['detail']['code'] == 'attendance_geo_out_of_range'
    assert (await db_session.scalars(select(AttendanceEvent))).all() == []
    inside = await client.post('/api/attendance/phone/mark', json={
        **payload, 'latitude': 43.2390, 'longitude': 76.8897, 'accuracy_m': 15,
    })
    assert inside.status_code == 200 and inside.json()['kind'] == 'in'
    first_event = await db_session.get(AttendanceEvent, inside.json()['id'])
    first_event.occurred_at = utcnow() - timedelta(minutes=3)
    await db_session.commit()
    _, kiosk_headers = await pair_kiosk(client)
    kiosk_mark = await client.post('/api/attendance/kiosk/mark', json=kiosk_capture_payload(), headers=kiosk_headers)
    assert kiosk_mark.status_code == 200 and kiosk_mark.json()['kind'] == 'out'


async def test_kiosk_recognition_is_organization_scoped(client, db_session, make_user, make_organization, monkeypatch):
    org_a = await make_organization(name='Kiosk A')
    org_b = await make_organization(name='Kiosk B')
    admin, password = await make_user(email='kiosk-admin@example.com', role=UserRole.org_admin, organization_id=org_a.id)
    vector = np.zeros(128, dtype=np.float32)
    vector[0] = 1
    monkeypatch.setattr(attendance_api, 'capture_descriptor', lambda images: vector)
    other = Employee(organization_id=org_b.id, full_name='Other Org', code_digest='f' * 64,
                     face_template=attendance_api.encode_template(vector), face_consent_at=utcnow())
    db_session.add(other)
    await db_session.commit()
    await login(client, admin.email, password)
    assert (await client.get('/api/attendance/kiosk/qr')).status_code == 401
    _, kiosk_headers = await pair_kiosk(client)
    response = await client.post('/api/attendance/kiosk/mark', json=kiosk_capture_payload(), headers=kiosk_headers)
    assert response.status_code == 422 and response.json()['detail']['code'] == 'face_not_recognized'
    assert (await db_session.scalars(select(AttendanceEvent))).all() == []
    own = Employee(organization_id=org_a.id, full_name='Own Org', code_digest='e' * 64,
                   face_template=attendance_api.encode_template(vector), face_consent_at=utcnow())
    db_session.add(own)
    await db_session.flush()
    old = AttendanceEvent(organization_id=org_a.id, employee_id=own.id, kind='in', source='manual', occurred_at=utcnow() - timedelta(hours=21))
    db_session.add(old)
    await db_session.commit()
    marked = await client.post('/api/attendance/kiosk/mark', json=kiosk_capture_payload(), headers=kiosk_headers)
    assert marked.status_code == 200 and marked.json()['kind'] == 'in'
    await db_session.refresh(old)
    assert old.needs_review is True
    fix = await client.post('/api/attendance/admin/events', json={
        'employee_id': str(own.id), 'kind': 'out', 'occurred_at': (utcnow() - timedelta(hours=20)).isoformat(), 'reason': 'Forgot checkout',
    })
    assert fix.status_code == 201
    await db_session.refresh(old)
    assert old.needs_review is False


async def test_kiosk_pairing_unpair_and_admin_scope(client, make_user, make_organization):
    org_a = await make_organization(name='Pair A')
    org_b = await make_organization(name='Pair B')
    admin_a, password_a = await make_user(email='pair-a@example.com', role=UserRole.org_admin, organization_id=org_a.id)
    admin_b, password_b = await make_user(email='pair-b@example.com', role=UserRole.org_admin, organization_id=org_b.id)
    assert (await client.get('/api/attendance/kiosk/state')).status_code == 401
    assert (await client.post('/api/attendance/admin/kiosks', json={'name': 'Unauthorized'})).status_code == 401
    await login(client, admin_a.email, password_a)
    kiosk_id, headers = await pair_kiosk(client)
    assert (await client.get('/api/attendance/kiosk/state', headers=headers)).status_code == 200
    assert (await client.get('/api/attendance/kiosk/qr', headers=headers)).status_code == 200
    assert (await client.get('/api/attendance/kiosk/qr')).status_code == 401
    assert (await client.post('/api/attendance/kiosk/pair', json={'code': 'not-a-code'})).status_code == 422
    await client.post('/api/auth/logout')
    await login(client, admin_b.email, password_b)
    assert (await client.get('/api/attendance/admin/kiosks')).json() == []
    assert (await client.post(f'/api/attendance/admin/kiosks/{kiosk_id}/unpair')).status_code == 404
    assert (await client.get('/api/attendance/kiosk/state', headers=headers)).status_code == 200
    await client.post('/api/auth/logout')
    await login(client, admin_a.email, password_a)
    replacement = await client.post(f'/api/attendance/admin/kiosks/{kiosk_id}/unpair')
    assert replacement.status_code == 200 and len(replacement.json()['pairing_code']) == 6
    assert (await client.get('/api/attendance/kiosk/state', headers=headers)).status_code == 401
    new_pair = await client.post('/api/attendance/kiosk/pair', json={'code': replacement.json()['pairing_code']})
    assert new_pair.status_code == 200
    new_headers = {'X-Kiosk-Token': new_pair.json()['device_token']}
    assert (await client.get('/api/attendance/kiosk/state', headers=new_headers)).status_code == 200
    assert (await client.delete(f'/api/attendance/admin/kiosks/{kiosk_id}')).status_code == 204
    assert (await client.get('/api/attendance/kiosk/state', headers=new_headers)).status_code == 401


async def test_kiosk_requires_two_valid_frames(client, make_user, make_organization):
    org = await make_organization(name='Frame Gate')
    admin, password = await make_user(email='frame-gate@example.com', role=UserRole.org_admin, organization_id=org.id)
    await login(client, admin.email, password)
    _, headers = await pair_kiosk(client)
    assert (await client.post('/api/attendance/kiosk/mark', json={'images': TEST_FRAMES[:1]}, headers=headers)).status_code == 422
    assert (await client.post('/api/attendance/kiosk/mark', json={'images': TEST_FRAMES * 2}, headers=headers)).status_code == 422
    assert (await client.post('/api/attendance/kiosk/mark', json=kiosk_capture_payload())).status_code == 401


async def test_employee_import_rejects_unknown_department_atomically(client, db_session, make_user, make_organization, monkeypatch):
    org = await make_organization(name='Import Org')
    admin, password = await make_user(email='import-admin@example.com', role=UserRole.org_admin, organization_id=org.id)
    department = Department(organization_id=org.id, name='Терапия')
    db_session.add(department)
    await db_session.commit()
    await login(client, admin.email, password)
    template = await client.get('/api/attendance/admin/employees/template')
    assert template.status_code == 200 and template.content[:2] == b'PK'
    invalid = employee_workbook([('Первый Сотрудник', 'Терапия', 'Врач'), ('Второй Сотрудник', 'Другое', 'Врач')])
    response = await client.post('/api/attendance/admin/employees/import', content=invalid)
    assert response.status_code == 422 and response.json()['detail']['row'] == 3
    assert (await client.get('/api/attendance/admin/employees')).json() == []
    monkeypatch.setattr(attendance_api, 'new_code', lambda: '0001')
    valid = employee_workbook([('Первый Сотрудник', 'Терапия', 'Врач'), ('Второй Сотрудник', 'Терапия', 'Медсестра')])
    response = await client.post('/api/attendance/admin/employees/import', content=valid)
    assert response.status_code == 200, response.text
    codes = [entry['code'] for entry in response.json()['employees']]
    assert codes == ['0001', '0002']
    people = (await client.get('/api/attendance/admin/employees')).json()
    assert len(people) == 2 and {person['department_id'] for person in people} == {str(department.id)}
    assert (await client.delete(f'/api/admin/departments/{department.id}')).status_code == 409
    for person in people:
        assert (await client.delete(f"/api/attendance/admin/employees/{person['id']}")).status_code == 204
    assert (await client.delete(f'/api/admin/departments/{department.id}')).status_code == 204


async def test_static_enrollment_requires_admin_approval(client, db_session, make_user, make_organization, monkeypatch):
    org = await make_organization(name='Enroll Org')
    admin, password = await make_user(email='enroll-admin@example.com', role=UserRole.org_admin, organization_id=org.id)
    department = Department(organization_id=org.id, name='Регистратура')
    db_session.add(department)
    await db_session.commit()
    vector = np.zeros(128, dtype=np.float32)
    vector[0] = 1
    monkeypatch.setattr(attendance_api, 'capture_descriptor', lambda images: vector)
    monkeypatch.setattr(attendance_api, 'encode_review_photo', lambda image: face_attendance._cipher().encrypt(b'face-jpeg'))
    await login(client, admin.email, password)
    created = (await client.post('/api/attendance/admin/employees', json={
        'full_name': 'Регистратор Один', 'department_id': str(department.id)})).json()
    settings = (await client.get('/api/attendance/admin/settings')).json()
    token = settings['enrollment_token']
    assert (await client.get('/api/attendance/enroll/context', params={'token': token})).status_code == 200
    _, kiosk_headers = await pair_kiosk(client)
    assert (await client.get('/api/attendance/kiosk/enrollment-qr', headers=kiosk_headers)).json()['token'] is None
    assert (await client.patch('/api/attendance/admin/settings', json={'enrollment_on_kiosk': True})).status_code == 200
    assert (await client.get('/api/attendance/kiosk/enrollment-qr', headers=kiosk_headers)).json()['token'] == token
    response = await client.post('/api/attendance/enroll/submit', json={
        'token': token, 'code': created['code'], 'images': TEST_FRAMES, 'consent_confirmed': False})
    assert response.status_code == 422
    response = await client.post('/api/attendance/enroll/submit', json={
        'token': token, 'code': created['code'], 'images': TEST_FRAMES, 'consent_confirmed': True})
    assert response.status_code == 200
    person = (await client.get('/api/attendance/admin/employees')).json()[0]
    assert person['face_pending'] is True and person['face_enrolled'] is False
    assert person['face_review_photo_available'] is True
    photo_url = f"/api/attendance/admin/employees/{created['id']}/pending-face-photo"
    photo = await client.get(photo_url)
    assert photo.status_code == 200 and photo.content == b'face-jpeg'
    assert photo.headers['cache-control'] == 'no-store, private'
    session = attendance_api.phone_session_token(org.id)
    unapproved = phone_capture_payload(session, created['code'])
    denied = await client.post('/api/attendance/phone/mark', json=unapproved)
    assert denied.status_code == 422 and denied.json()['detail']['code'] == 'face_not_recognized'
    unknown_code = '9999' if created['code'] != '9999' else '0000'
    assert (await client.post('/api/attendance/phone/mark', json=phone_capture_payload(session, unknown_code))).status_code == 422
    approval_url = f"/api/attendance/admin/employees/{created['id']}/approve-face"
    assert (await client.post(approval_url, json={'identity_checked': False})).status_code == 422
    approved = await client.post(approval_url, json={'identity_checked': True})
    assert approved.status_code == 200 and approved.json()['face_enrolled'] is True
    assert approved.json()['face_review_photo_available'] is False
    assert (await client.get(photo_url)).status_code == 404
    rotated = (await client.post('/api/attendance/admin/settings/rotate-enrollment-qr')).json()['enrollment_token']
    assert rotated != token
    assert (await client.get('/api/attendance/enroll/context', params={'token': token})).status_code == 404
    stats = (await client.get('/api/attendance/admin/stats')).json()
    assert stats['employees'] == 1 and stats['enrolled'] == 1 and stats['pending'] == 0
