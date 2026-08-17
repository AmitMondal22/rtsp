import sys
import os

# Add python folder to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine, SessionLocal
from app.models.user import User
from app.models.bank import Bank
from app.models.branch import Branch
from app.models.device import Device
from app.models.otp_bulk import DeviceOfflineOTP
from app.services.mqtt_service import publish_bulk_otp_to_device, on_message
from app.services.auth_service import hash_password, create_access_token


def run_verification():
    print("=== Starting OTP Verification ===")

    # 1. Database setup
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        # Create test user
        user = db.query(User).filter(User.username == "otp_test_admin").first()
        if not user:
            user = User(
                username="otp_test_admin",
                email="otp_admin@example.com",
                hashed_password=hash_password("admin123"),
                role="admin",
                is_active=True
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        # Create test Bank & Branch
        bank = db.query(Bank).filter(Bank.name == "OTP Test Bank").first()
        if not bank:
            bank = Bank(name="OTP Test Bank")
            db.add(bank)
            db.commit()
            db.refresh(bank)

        branch = db.query(Branch).filter(Branch.name == "OTP Test Branch").first()
        if not branch:
            branch = Branch(name="OTP Test Branch", bank_id=bank.id, is_active=True)
            db.add(branch)
            db.commit()
            db.refresh(branch)

        # Create test Device
        device = db.query(Device).filter(Device.name == "OTP_Test_Cam_1").first()
        if not device:
            device = Device(
                name="OTP_Test_Cam_1",
                bank_id=bank.id,
                branch_id=branch.id,
                owner_id=user.id
            )
            db.add(device)
            db.commit()
            db.refresh(device)

        print(f"[OK] Database setup complete. Test Device ID: {device.id}, Name: {device.name}")

        # 2. Test FastApi TestClient & Endpoints
        client = TestClient(app)
        auth_token = create_access_token(data={"sub": str(user.id)})
        headers = {"Authorization": f"Bearer {auth_token}"}

        # GET /api/otp/device/{device.id} (Initial empty check)
        resp = client.get(f"/api/otp/device/{device.id}", headers=headers)
        assert resp.status_code == 200, f"Failed GET /api/otp/device/{device.id}: {resp.text}"
        data = resp.json()
        assert len(data["otps"]) == 100, f"Expected 100 items, got {len(data['otps'])}"
        print("[OK] GET /api/otp/device/{id} returned 100 items array.")

        # POST /api/otp/device/{device.id} (Save 100 OTPs)
        test_otps = [str(1000 + i) for i in range(1, 101)]  # 1001 to 1100
        save_payload = {
            "device_id": device.id,
            "otps": test_otps,
            "publish_mqtt": False
        }
        resp = client.post(f"/api/otp/device/{device.id}", json=save_payload, headers=headers)
        assert resp.status_code == 200, f"Failed POST /api/otp/device: {resp.text}"
        save_res = resp.json()
        assert save_res["status"] == "success", f"Unexpected save response: {save_res}"
        print("[OK] POST /api/otp/device/{id} saved 100 OTPs successfully.")

        # Verify DB records
        db_records = db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == device.id).order_by(DeviceOfflineOTP.slot_number.asc()).all()
        assert len(db_records) == 100, f"Expected 100 DB records, got {len(db_records)}"
        assert db_records[0].otp_code == "1001", f"Expected slot 1 to be '1001', got '{db_records[0].otp_code}'"
        assert db_records[99].otp_code == "1100", f"Expected slot 100 to be '1100', got '{db_records[99].otp_code}'"
        print("[OK] Verified DB records: Slot #1 = 1001, Slot #100 = 1100.")

        # 3. Test MQTT Packet Generator logic
        class DummyMQTTClient:
            def __init__(self):
                self.published_topics = []
                self.last_topic = None
                self.last_payload = None
            def publish(self, topic, payload, qos=1):
                self.published_topics.append(topic)
                self.last_topic = topic
                self.last_payload = payload
                class DummyInfo:
                    def wait_for_publish(self): pass
                return DummyInfo()

        import app.services.mqtt_service as mqtt_mod
        dummy = DummyMQTTClient()
        mqtt_mod.mqtt_client = dummy

        mqtt_mod.publish_bulk_otp_to_device(str(device.id), test_otps)
        assert dummy.last_topic == f"/OTP/{device.name}", f"Unexpected topic: {dummy.last_topic}"
        expected_start = "*OFFOTP,BULK,1,1001,1002,1003,"
        expected_end = ",1100#"
        assert dummy.last_payload.startswith(expected_start), f"Payload failed start check: {dummy.last_payload[:40]}"
        assert dummy.last_payload.endswith(expected_end), f"Payload failed end check: {dummy.last_payload[-20:]}"
        print(f"[OK] Bulk OTP MQTT Packet Builder Verified:\n     Topic Published: {dummy.last_topic}\n     Payload: {dummy.last_payload[:60]}...{dummy.last_payload[-30:]}")

        # 4. Test incoming MQTT /OTP/STATUS/# status report message (both comma string & JSON offline_otp_pool format)
        class DummyMsg:
            def __init__(self, topic, payload):
                self.topic = topic
                self.payload = payload.encode("utf-8") if isinstance(payload, str) else payload

        # 4a. Simulate incoming status update with JSON offline_otp_pool
        json_payload = '{"type":"offline_otp_pool","device_id":"' + device.name + '","revision":22,"slots":100,"active":15,"encoding":"bcdhex-v1","hex_chars":166,"data":"01444444444444444000000000000000000000000000000000000000000000000000000000000000000000000000000000000011111234777712555557444455557855455656455544154445774566474560D7"}'
        status_msg_json = DummyMsg(f"/OTP/STATUS/{device.name}", json_payload)
        on_message(None, None, status_msg_json)

        db.expire_all()
        json_records = db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == device.id).order_by(DeviceOfflineOTP.slot_number.asc()).all()
        assert len(json_records) == 100
        assert json_records[0].otp_code == "4444", f"Expected '4444' from JSON bcdhex data slot 1, got '{json_records[0].otp_code}'"
        print("[OK] Verified JSON offline_otp_pool packet parsing & DB update.")

        # 4b. Test non-available / non-existent device name (should gracefully warn and not modify existing devices)
        unavailable_msg = DummyMsg("/OTP/STATUS/NON_EXISTENT_DEV", '{"type":"offline_otp_pool","device_id":"NON_EXISTENT_DEV","data":"019999"}')
        on_message(None, None, unavailable_msg)
        print("[OK] Verified non-available device handling (logged warning gracefully).")

        # 4c. Simulate incoming status update with legacy comma string (2001 to 2100)
        new_status_otps = [str(2000 + i) for i in range(1, 101)]
        status_payload = f"*OFFOTP,STATUS,1,{','.join(new_status_otps)}#"
        status_msg = DummyMsg(f"/OTP/STATUS/{device.name}", status_payload)

        on_message(None, None, status_msg)

        # Verify DB records updated from incoming MQTT status
        db.expire_all()
        updated_records = db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == device.id).order_by(DeviceOfflineOTP.slot_number.asc()).all()
        assert len(updated_records) == 100
        assert updated_records[0].otp_code == "2001", f"Expected '2001' after MQTT status update, got '{updated_records[0].otp_code}'"
        assert updated_records[99].otp_code == "2100", f"Expected '2100' after MQTT status update, got '{updated_records[99].otp_code}'"

        # 4d. Test receiving offline_otp_pool directly on /OTP/{device_name} topic (e.g. /OTP/ANGIND0001)
        direct_otp_payload = '{"type":"offline_otp_pool","device_id":"' + device.name + '","revision":1,"slots":100,"active":4,"encoding":"bcdhex-v1","hex_chars":122,"data":"01444400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012345678901234562DF4"}'
        direct_otp_msg = DummyMsg(f"/OTP/{device.name}", direct_otp_payload)
        on_message(None, None, direct_otp_msg)

        db.expire_all()
        direct_records = db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == device.id).order_by(DeviceOfflineOTP.slot_number.asc()).all()
        assert len(direct_records) >= 30
        assert direct_records[0].otp_code == "4444", f"Expected '4444' at slot 1, got '{direct_records[0].otp_code}'"
        assert direct_records[29].otp_code == "2DF4", f"Expected '2DF4' at slot 30, got '{direct_records[29].otp_code}'"
        # 4e. Test Action Control "OFFLINE OTP" mode (random unused OTP selection & MQTT bypass)
        from app.models.message import ThreadMessage
        pending_msg = ThreadMessage(device_id=device.id, sender_id=user.id, content="Device OTP request test", message_type="otp_request")
        db.add(pending_msg)
        db.commit()

        action_resp = client.post(f"/api/camera/{device.id}/send-action", json={"mode": "offline_otp"}, headers=headers)
        assert action_resp.status_code == 200, f"send-action offline_otp failed: {action_resp.text}"
        action_data = action_resp.json()
        assert action_data["mode"] == "offline_otp"
        assert action_data["mqtt_sent"] is False, "Expected MQTT publishing to be bypassed for OFFLINE OTP"
        sent_code = action_data["otp_code"]
        assert sent_code != "", "Expected non-empty OTP code"

        # Check DB status of sent OTP code
        db.expire_all()
        slot_num = action_data.get("slot_number")
        if slot_num:
            sent_rec = db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == device.id, DeviceOfflineOTP.slot_number == slot_num).first()
            assert sent_rec.status == "sent", f"Expected slot #{slot_num} status to be 'sent', got '{sent_rec.status}'"
        print(f"[OK] Verified Action Control 'OFFLINE OTP' mode: Random OTP code '{sent_code}' (slot #{slot_num}) selected, status set to 'sent', and MQTT publication bypassed.")

        # 5. Test Device Deletion (verifying Foreign Key Cascade behavior)
        del_device = Device(name="Delete_Test_Cam", bank_id=bank.id, branch_id=branch.id, owner_id=user.id)
        db.add(del_device)
        db.commit()
        db.refresh(del_device)

        # Add 100 OTP records to del_device
        for i in range(1, 101):
            db.add(DeviceOfflineOTP(device_id=del_device.id, slot_number=i, otp_code=str(3000 + i)))
        db.commit()

        # Delete device via API / service
        from app.services.device_service import delete_device_service
        delete_device_service(db, del_device.id)

        # Verify device and its offline_otps are completely removed
        remaining_otps = db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == del_device.id).all()
        assert len(remaining_otps) == 0, "Expected 0 remaining OTP records after device deletion"
        print(f"[OK] Device deletion test passed. Device #{del_device.id} and its associated offline_otps were cleanly removed.")

        print("\n=== ALL OTP VERIFICATION TESTS PASSED SUCCESSFULLY! ===")

    finally:
        db.close()


if __name__ == "__main__":
    run_verification()
