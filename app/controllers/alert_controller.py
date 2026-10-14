import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models.alert import SecurityAlert
from app.models.device import Device
from app.models.user import User
from app.services.auth_service import get_current_user
from app.utils.timezone import get_ist_now

router = APIRouter(prefix="/api/alerts", tags=["Security Alerts"])


def format_time_ago(dt: datetime.datetime) -> str:
    if not dt:
        return "—"
    now = get_ist_now()
    if dt.tzinfo is None and now.tzinfo is not None:
        dt = dt.replace(tzinfo=now.tzinfo)
    diff = now - dt
    total_seconds = int(diff.total_seconds())
    if total_seconds < 60:
        return "Just now"
    elif total_seconds < 3600:
        return f"{total_seconds // 60}m ago"
    elif total_seconds < 86400:
        return f"{total_seconds // 3600}h ago"
    elif total_seconds < 86400 * 30:
        return f"{total_seconds // 86400}d ago"
    else:
        return dt.strftime("%Y-%m-%d")


def seed_default_alerts_if_empty(db: Session):
    # No dummy or seed alerts
    pass


class AlertStatusUpdate(BaseModel):
    status: str  # "Open", "In Progress", "Resolved"


class AlertCreate(BaseModel):
    title: str
    severity: str = "Medium"
    alert_type: str = "Security Alert"
    device_name: Optional[str] = "ANG-01"
    camera_name: Optional[str] = "CAM-01"
    is_simulated: bool = True
    details: Optional[str] = None


@router.get("/")
def get_alerts(
    search: Optional[str] = None,
    severity: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve all security alerts, dynamically combined with real device warnings."""
    seed_default_alerts_if_empty(db)

    # 1. Fetch persistent alerts from DB
    query = db.query(SecurityAlert).order_by(SecurityAlert.id.asc())

    if severity and severity.lower() != "all":
        query = query.filter(SecurityAlert.severity.ilike(severity))
    if status_filter and status_filter.lower() != "all":
        query = query.filter(SecurityAlert.status.ilike(status_filter))

    db_alerts = query.all()

    # 2. Check for real live devices that are offline
    real_offline_devices = db.query(Device).filter(Device.is_online == False).all()
    existing_offline_names = {a.device_name for a in db_alerts if a.alert_type == "Device Offline"}

    for dev in real_offline_devices:
        if dev.name not in existing_offline_names:
            live_alert = SecurityAlert(
                title=f"{dev.name} offline",
                is_simulated=False,
                severity="Critical",
                alert_type="Device Offline",
                device_name=dev.name,
                camera_name=f"CAM-{dev.name}",
                status="Open",
                handled_by="—",
                created_at=dev.updated_at or get_ist_now(),
                details="Real-time RTSP/MQTT watchdog reported device offline.",
            )
            db.add(live_alert)
            db.commit()
            db_alerts.append(live_alert)

    # 3. Format result list with formatted time
    results = []
    for a in db_alerts:
        raised_str = format_time_ago(a.created_at)
        row = {
            "id": a.id,
            "title": a.title,
            "is_simulated": a.is_simulated,
            "severity": a.severity,
            "alert_type": a.alert_type,
            "device_name": a.device_name or "—",
            "camera_name": a.camera_name or "—",
            "status": a.status,
            "handled_by": a.handled_by or "—",
            "raised": raised_str,
            "created_at": a.created_at.isoformat() if a.created_at else "",
            "details": a.details or "",
        }
        if search:
            s_lower = search.lower().strip()
            text_corpus = f"{row['title']} {row['device_name']} {row['camera_name']} {row['alert_type']} {row['severity']} {row['status']}".lower()
            if s_lower not in text_corpus:
                continue
        results.append(row)

    # Summary statistics
    total = len(results)
    open_count = sum(1 for r in results if r["status"] == "Open")
    critical_count = sum(1 for r in results if r["severity"].lower() == "critical")
    high_count = sum(1 for r in results if r["severity"].lower() == "high")

    return {
        "success": True,
        "count": total,
        "open_count": open_count,
        "critical_count": critical_count,
        "high_count": high_count,
        "alerts": results,
    }


@router.post("/{alert_id}/status")
def update_alert_status(
    alert_id: int,
    payload: AlertStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update status of a security alert (Open, In Progress, Resolved)."""
    alert = db.query(SecurityAlert).filter(SecurityAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    new_status = payload.status.strip()
    alert.status = new_status
    if new_status.lower() in ("resolved", "closed"):
        alert.handled_by = current_user.username
        alert.resolved_at = get_ist_now()
    elif new_status.lower() == "in progress":
        alert.handled_by = current_user.username
    else:
        alert.handled_by = "—"
        alert.resolved_at = None

    db.commit()
    return {
        "success": True,
        "alert_id": alert.id,
        "status": alert.status,
        "handled_by": alert.handled_by,
        "message": f"Alert status updated to {alert.status}",
    }


@router.post("/simulate")
def create_simulated_alert(
    payload: AlertCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Inject a simulated or live security alert."""
    alert = SecurityAlert(
        title=payload.title,
        severity=payload.severity,
        alert_type=payload.alert_type,
        device_name=payload.device_name,
        camera_name=payload.camera_name,
        is_simulated=payload.is_simulated,
        status="Open",
        handled_by="—",
        details=payload.details,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return {"success": True, "alert_id": alert.id, "alert": alert.title}


@router.post("/reset-defaults")
def reset_default_alerts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clear all simulated or dummy alerts."""
    db.query(SecurityAlert).filter(SecurityAlert.is_simulated == True).delete()
    db.commit()
    return {"success": True, "message": "All simulated alerts cleared."}
