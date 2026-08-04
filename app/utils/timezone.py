"""
Timezone helper module for Indian Standard Time (IST - Asia/Kolkata, UTC+05:30).
"""
import datetime

# IST Time Zone offset: UTC+05:30
IST_OFFSET = datetime.timedelta(hours=5, minutes=30)
IST_TZ = datetime.timezone(IST_OFFSET)


def get_ist_now() -> datetime.datetime:
    """
    Return current datetime in Indian Standard Time (IST) as naive datetime.
    Used for database defaults and timestamps.
    """
    return datetime.datetime.now(IST_TZ).replace(tzinfo=None)


def get_ist_now_aware() -> datetime.datetime:
    """
    Return current datetime in Indian Standard Time (IST) with timezone info attached.
    """
    return datetime.datetime.now(IST_TZ)


def format_ist_datetime(dt: datetime.datetime = None, fmt: str = "%Y-%m-%d %H:%M:%S IST") -> str:
    """
    Format a datetime object in IST string representation.
    """
    if dt is None:
        dt = get_ist_now()
    return dt.strftime(fmt)
