import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.deps import current_admin, current_organization_id, get_in_org_or_404
from app.config import settings
from app.db import get_db
from app.media import TV_MEDIA_CHUNK_BYTES
from app.models.department import Department, DepartmentScheduleItem
from app.models.attendance import Employee
from app.models.enums import AuditActorType
from app.models.organization import Organization
from app.models.tv_media import TVMedia, TVMediaChunk
from app.models.user import User
from app.schemas.tv_signage import (
    DepartmentCreate, DepartmentOut, DepartmentUpdate, ScheduleItemCreate,
    ScheduleItemOut, ScheduleItemUpdate, TVMediaCreate, TVMediaOut, TVMediaUpdate,
)
from app.services.audit import log_action
from app.services.realtime import defer_event, organization_channel
from app.services.schedule_import import MAX_IMPORT_BYTES, ScheduleImportError, parse_schedule_workbook

router = APIRouter(prefix="/admin", tags=["tv-signage"])


def _updated(db: AsyncSession, organization_id: uuid.UUID, event: str) -> None:
    defer_event(db, organization_channel(organization_id), event)


async def _audit(db: AsyncSession, actor: User, organization_id: uuid.UUID,
                 action: str, entity_type: str, entity_id: uuid.UUID, payload: dict | None = None) -> None:
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
                     organization_id=organization_id, action=action,
                     entity_type=entity_type, entity_id=entity_id, payload=payload or {})


async def _department(db: AsyncSession, department_id: uuid.UUID, org_id: uuid.UUID) -> Department:
    return await get_in_org_or_404(db, Department, department_id, org_id)


async def _item(db: AsyncSession, department_id: uuid.UUID, item_id: uuid.UUID,
                org_id: uuid.UUID) -> DepartmentScheduleItem:
    await _department(db, department_id, org_id)
    item = await db.get(DepartmentScheduleItem, item_id)
    if item is None or item.department_id != department_id:
        raise HTTPException(status_code=404, detail="Not found")
    return item


@router.get("/departments", response_model=list[DepartmentOut])
async def list_departments(
    db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
    org_id: uuid.UUID = Depends(current_organization_id),
):
    return list((await db.scalars(select(Department).where(Department.organization_id == org_id)
                                  .order_by(Department.sort_order, Department.name))).all())


@router.post("/departments", response_model=DepartmentOut, status_code=201)
async def create_department(
    payload: DepartmentCreate, db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id),
):
    existing = await db.scalar(select(Department.id).where(
        Department.organization_id == org_id, Department.name == payload.name))
    if existing is not None:
        raise HTTPException(status_code=409, detail={"code": "department_exists"})
    department = Department(organization_id=org_id, **payload.model_dump())
    db.add(department)
    await db.flush()
    await _audit(db, actor, org_id, "department.created", "department", department.id,
                 {"name": department.name})
    _updated(db, org_id, "signage.updated")
    await db.commit()
    return department


@router.post("/departments/import")
async def import_department_schedules(
    request: Request, db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id),
):
    """Replace schedules only for departments named in the validated workbook."""
    content_length = request.headers.get("content-length")
    if content_length is not None and (not content_length.isdigit() or int(content_length) > MAX_IMPORT_BYTES):
        raise HTTPException(status_code=413, detail={"code": "excel_too_large"})
    data = bytearray()
    async for part in request.stream():
        data.extend(part)
        if len(data) > MAX_IMPORT_BYTES:
            raise HTTPException(status_code=413, detail={"code": "excel_too_large"})
    try:
        grouped = await run_in_threadpool(parse_schedule_workbook, bytes(data))
    except ScheduleImportError as exc:
        detail = {"code": exc.code}
        if exc.row is not None:
            detail["row"] = exc.row
        raise HTTPException(status_code=413 if exc.code == "excel_too_large" else 422, detail=detail) from exc

    await db.execute(select(Organization.id).where(Organization.id == org_id).with_for_update())
    existing = (await db.scalars(select(Department).where(Department.organization_id == org_id))).all()
    departments = {department.name: department for department in existing}
    created = 0
    for name in grouped:
        if name not in departments:
            department = Department(organization_id=org_id, name=name)
            db.add(department)
            departments[name] = department
            created += 1
    await db.flush()
    department_ids = [departments[name].id for name in grouped]
    await db.execute(delete(DepartmentScheduleItem).where(DepartmentScheduleItem.department_id.in_(department_ids)))
    for name, items in grouped.items():
        for item in items:
            db.add(DepartmentScheduleItem(department_id=departments[name].id, **item.model_dump()))
    await _audit(db, actor, org_id, "department.schedule_imported", "organization", org_id,
                 {"departments": len(grouped), "created_departments": created,
                  "schedule_items": sum(map(len, grouped.values()))})
    _updated(db, org_id, "signage.updated")
    await db.commit()
    return {"departments": len(grouped), "created_departments": created,
            "schedule_items": sum(map(len, grouped.values()))}


@router.patch("/departments/{department_id}", response_model=DepartmentOut)
async def update_department(
    department_id: uuid.UUID, payload: DepartmentUpdate,
    db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
    org_id: uuid.UUID = Depends(current_organization_id),
):
    department = await _department(db, department_id, org_id)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] != department.name:
        existing = await db.scalar(select(Department.id).where(
            Department.organization_id == org_id, Department.name == changes["name"]))
        if existing is not None:
            raise HTTPException(status_code=409, detail={"code": "department_exists"})
    for key, value in changes.items():
        setattr(department, key, value)
    await _audit(db, actor, org_id, "department.updated", "department", department.id, changes)
    _updated(db, org_id, "signage.updated")
    await db.commit()
    return department


@router.delete("/departments/{department_id}", status_code=204)
async def delete_department(
    department_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id),
):
    department = await _department(db, department_id, org_id)
    if await db.scalar(select(Employee.id).where(Employee.department_id == department.id, Employee.deleted_at.is_(None)).limit(1)):
        raise HTTPException(status_code=409, detail={"code": "department_has_employees"})
    await db.execute(update(Employee).where(Employee.department_id == department.id).values(department_id=None))
    await db.execute(delete(DepartmentScheduleItem).where(DepartmentScheduleItem.department_id == department.id))
    await db.delete(department)
    await _audit(db, actor, org_id, "department.deleted", "department", department_id,
                 {"name": department.name})
    _updated(db, org_id, "signage.updated")
    await db.commit()


@router.get("/departments/{department_id}/schedule", response_model=list[ScheduleItemOut])
async def list_schedule(
    department_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id),
):
    await _department(db, department_id, org_id)
    return list((await db.scalars(select(DepartmentScheduleItem)
                                  .where(DepartmentScheduleItem.department_id == department_id)
                                  .order_by(DepartmentScheduleItem.weekday,
                                            DepartmentScheduleItem.starts_at,
                                            DepartmentScheduleItem.sort_order))).all())


@router.post("/departments/{department_id}/schedule", response_model=ScheduleItemOut, status_code=201)
async def create_schedule_item(
    department_id: uuid.UUID, payload: ScheduleItemCreate,
    db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
    org_id: uuid.UUID = Depends(current_organization_id),
):
    await _department(db, department_id, org_id)
    item = DepartmentScheduleItem(department_id=department_id, **payload.model_dump())
    db.add(item)
    await db.flush()
    await _audit(db, actor, org_id, "department.schedule_created", "department_schedule_item", item.id,
                 {"department_id": str(department_id), **jsonable_encoder(payload.model_dump())})
    _updated(db, org_id, "signage.updated")
    await db.commit()
    return item


@router.patch("/departments/{department_id}/schedule/{item_id}", response_model=ScheduleItemOut)
async def update_schedule_item(
    department_id: uuid.UUID, item_id: uuid.UUID, payload: ScheduleItemUpdate,
    db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
    org_id: uuid.UUID = Depends(current_organization_id),
):
    item = await _item(db, department_id, item_id, org_id)
    changes = payload.model_dump(exclude_unset=True)
    start = changes.get("starts_at", item.starts_at)
    end = changes.get("ends_at", item.ends_at)
    if start.tzinfo or end.tzinfo or start >= end:
        raise HTTPException(status_code=422, detail={"code": "invalid_schedule_interval"})
    for key, value in changes.items():
        setattr(item, key, value)
    await _audit(db, actor, org_id, "department.schedule_updated", "department_schedule_item", item.id,
                 {"department_id": str(department_id), **jsonable_encoder(changes)})
    _updated(db, org_id, "signage.updated")
    await db.commit()
    return item


@router.delete("/departments/{department_id}/schedule/{item_id}", status_code=204)
async def delete_schedule_item(
    department_id: uuid.UUID, item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
    org_id: uuid.UUID = Depends(current_organization_id),
):
    item = await _item(db, department_id, item_id, org_id)
    snapshot = {"department_id": str(department_id), "doctor_name": item.doctor_name,
                "service_name": item.service_name, "room": item.room, "weekday": item.weekday,
                "starts_at": item.starts_at, "ends_at": item.ends_at}
    await db.delete(item)
    await _audit(db, actor, org_id, "department.schedule_deleted", "department_schedule_item", item_id,
                 jsonable_encoder(snapshot))
    _updated(db, org_id, "signage.updated")
    await db.commit()


def _media_limit_bytes(org: Organization) -> int:
    mb = settings.video_extended_limit_mb if org.video_large_upload_enabled else settings.video_base_limit_mb
    return mb * 1024 * 1024


@router.get("/tv-media/limits")
async def get_media_limits(
    db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
    org_id: uuid.UUID = Depends(current_organization_id),
):
    org = await db.get(Organization, org_id)
    return {"max_video_bytes": _media_limit_bytes(org), "max_image_bytes": 10 * 1024 * 1024,
            "chunk_bytes": TV_MEDIA_CHUNK_BYTES, "large_upload_enabled": org.video_large_upload_enabled}


@router.get("/tv-media", response_model=list[TVMediaOut])
async def list_media(
    db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
    org_id: uuid.UUID = Depends(current_organization_id),
):
    return list((await db.scalars(select(TVMedia).where(TVMedia.organization_id == org_id)
                                  .order_by(TVMedia.sort_order, TVMedia.created_at))).all())


@router.post("/tv-media", response_model=TVMediaOut, status_code=201)
async def create_media(
    payload: TVMediaCreate, db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id),
):
    org = await db.get(Organization, org_id)
    max_bytes = _media_limit_bytes(org) if payload.mime_type.startswith("video/") else 10 * 1024 * 1024
    if payload.size_bytes > max_bytes:
        raise HTTPException(status_code=413, detail={"code": "media_too_large", "max_bytes": max_bytes})
    media = TVMedia(organization_id=org_id, **payload.model_dump())
    db.add(media)
    await db.flush()
    await _audit(db, actor, org_id, "tv_media.upload_started", "tv_media", media.id,
                 {"kind": media.kind, "mime_type": media.mime_type, "size_bytes": media.size_bytes})
    await db.commit()
    return media


@router.put("/tv-media/{media_id}/chunks/{index}", response_model=TVMediaOut)
async def upload_media_chunk(
    media_id: uuid.UUID, index: int, request: Request,
    db: AsyncSession = Depends(get_db), actor: User = Depends(current_admin),
    org_id: uuid.UUID = Depends(current_organization_id),
):
    media = await get_in_org_or_404(db, TVMedia, media_id, org_id)
    await db.refresh(media, with_for_update=True)
    if media.is_ready:
        raise HTTPException(status_code=409, detail={"code": "media_already_ready"})
    expected_count = (media.size_bytes + TV_MEDIA_CHUNK_BYTES - 1) // TV_MEDIA_CHUNK_BYTES
    if index < 0 or index >= expected_count:
        raise HTTPException(status_code=422, detail={"code": "invalid_chunk_index"})
    expected_size = min(TV_MEDIA_CHUNK_BYTES, media.size_bytes - index * TV_MEDIA_CHUNK_BYTES)
    content_length = request.headers.get("content-length")
    if content_length is not None and (not content_length.isdigit() or int(content_length) > expected_size):
        raise HTTPException(status_code=413, detail={"code": "media_chunk_too_large"})
    data = bytearray()
    async for part in request.stream():
        data.extend(part)
        if len(data) > expected_size:
            raise HTTPException(status_code=413, detail={"code": "media_chunk_too_large"})
    if len(data) != expected_size:
        raise HTTPException(status_code=422, detail={"code": "invalid_chunk_size"})
    chunk = await db.get(TVMediaChunk, (media_id, index))
    if chunk is None:
        db.add(TVMediaChunk(media_id=media_id, chunk_index=index, data=bytes(data)))
        media.uploaded_bytes += len(data)
    elif chunk.data != data:
        raise HTTPException(status_code=409, detail={"code": "chunk_conflict"})
    await db.commit()
    return media


def _valid_signature(mime: str, data: bytes) -> bool:
    if mime == "video/mp4":
        return len(data) >= 12 and data[4:8] == b"ftyp"
    if mime == "video/webm":
        return data.startswith(b"\x1a\x45\xdf\xa3")
    if mime == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if mime == "image/webp":
        return data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    return False


@router.post("/tv-media/{media_id}/complete", response_model=TVMediaOut)
async def complete_media(
    media_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id),
):
    media = await get_in_org_or_404(db, TVMedia, media_id, org_id)
    await db.refresh(media, with_for_update=True)
    if media.is_ready:
        return media
    expected_count = (media.size_bytes + TV_MEDIA_CHUNK_BYTES - 1) // TV_MEDIA_CHUNK_BYTES
    count = await db.scalar(select(func.count()).select_from(TVMediaChunk)
                            .where(TVMediaChunk.media_id == media_id))
    if count != expected_count or media.uploaded_bytes != media.size_bytes:
        raise HTTPException(status_code=409, detail={"code": "upload_incomplete"})
    first_chunk = await db.get(TVMediaChunk, (media_id, 0))
    if first_chunk is None or not _valid_signature(media.mime_type, first_chunk.data):
        raise HTTPException(status_code=422, detail={"code": "invalid_media_format"})
    media.is_ready = True
    await _audit(db, actor, org_id, "tv_media.upload_completed", "tv_media", media.id,
                 {"title": media.title, "kind": media.kind, "size_bytes": media.size_bytes})
    _updated(db, org_id, "signage.updated")
    await db.commit()
    return media


@router.patch("/tv-media/{media_id}", response_model=TVMediaOut)
async def update_media(
    media_id: uuid.UUID, payload: TVMediaUpdate, db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id),
):
    media = await get_in_org_or_404(db, TVMedia, media_id, org_id)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("kind") == "video" and not media.mime_type.startswith("video/"):
        raise HTTPException(status_code=422, detail={"code": "invalid_media_kind"})
    for key, value in changes.items():
        setattr(media, key, value)
    await _audit(db, actor, org_id, "tv_media.updated", "tv_media", media.id, changes)
    _updated(db, org_id, "signage.updated")
    await db.commit()
    return media


@router.delete("/tv-media/{media_id}", status_code=204)
async def delete_media(
    media_id: uuid.UUID, db: AsyncSession = Depends(get_db),
    actor: User = Depends(current_admin), org_id: uuid.UUID = Depends(current_organization_id),
):
    media = await get_in_org_or_404(db, TVMedia, media_id, org_id)
    await db.execute(delete(TVMediaChunk).where(TVMediaChunk.media_id == media.id))
    await db.delete(media)
    await _audit(db, actor, org_id, "tv_media.deleted", "tv_media", media.id,
                 {"title": media.title})
    _updated(db, org_id, "signage.updated")
    await db.commit()
