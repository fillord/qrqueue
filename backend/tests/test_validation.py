import pytest
from pydantic import ValidationError
from app.schemas.organization import OrganizationCreate, OrganizationUpdate
from app.schemas.queue import QueueCreate, QueueUpdate, ScheduleReplace
from app.schemas.staff import StaffCreate


@pytest.mark.parametrize('schema,payload', [
    (OrganizationCreate, {'name':'Org','timezone':'Mars/Base'}),
    (OrganizationUpdate, {'timezone':None}),
    (OrganizationUpdate, {'name':' '}),
    (OrganizationUpdate, {'brand_color':'red;display:none'}),
    (QueueUpdate, {'status':None}),
    (QueueUpdate, {'presence_timeout_min':0}),
    (QueueCreate, {'name':'Queue','ticket_prefix':'A','latitude':91,'longitude':0,'geo_radius_m':10}),
    (ScheduleReplace, {'schedule':[{'weekday':1,'opens_at':'18:00','closes_at':'09:00'}]}),
    (ScheduleReplace, {'schedule':[{'weekday':1,'opens_at':'09:00','closes_at':'18:00'}]*2}),
    (StaffCreate, {'email':'a@example.com','full_name':'Ada','password':'я'*40,'role':'operator'}),
])
def test_rejects_invalid_configuration(schema, payload):
    with pytest.raises(ValidationError):
        schema.model_validate(payload)


def test_patch_supports_clearing_nullable_fields_and_omission():
    assert OrganizationUpdate(logo_url=None).model_dump(exclude_unset=True) == {'logo_url': None}
    assert QueueUpdate(daily_ticket_limit=None).model_dump(exclude_unset=True) == {'daily_ticket_limit': None}
    assert QueueUpdate().model_dump(exclude_unset=True) == {}
