import urllib.request
import urllib.error
import json

BASE_URL = "http://localhost:8000"

def make_request(url, method="GET", data=None, headers=None):
    if headers is None:
        headers = {}
    req_data = None
    if data is not None:
        req_data = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            res_data = response.read().decode("utf-8")
            return response.status, json.loads(res_data) if res_data else {}
    except urllib.error.HTTPError as e:
        res_data = e.read().decode("utf-8")
        try:
            body = json.loads(res_data)
        except Exception:
            body = res_data
        return e.code, body

def test_flow():
    print("=== Testing Integration Flow (urllib) ===")
    
    # 1. Verify 401 Unauthorized for get me when not authenticated
    print("\n1. Verifying /api/users/me returns 401 when not logged in...")
    status, res = make_request(f"{BASE_URL}/api/users/me")
    print(f"Status Code: {status}")
    assert status == 401, f"Expected 401 Unauthorized, got {status}"
    print("Verified successfully!")

    # 2. Login as superadmin
    print("\n2. Logging in as superadmin...")
    status, res = make_request(f"{BASE_URL}/api/users/login", method="POST", data={
        "username": "superadmin",
        "password": "adminpassword"
    })
    print(f"Status Code: {status}")
    assert status == 200, f"Login failed: {res}"
    super_token = res["access_token"]
    print("Login successful! Token acquired.")

    super_headers = {"Authorization": f"Bearer {super_token}"}

    # Debug: list all users
    status, users = make_request(f"{BASE_URL}/api/users/", headers=super_headers)
    print(f"Current Users in DB: {users}")

    # 3. Superadmin creates Bank and Bank Admin
    print("\n3. Creating Chase Bank and Admin...")
    status, res = make_request(f"{BASE_URL}/api/banks/", method="POST", data={
        "bank_name": "Chase Bank",
        "username": "chaseadmin",
        "email": "chaseadmin@example.com",
        "password": "chasepassword"
    }, headers=super_headers)
    print(f"Status Code: {status}")
    if status == 400 and "already exists" in str(res):
        print("Bank already exists. Proceeding...")
    else:
        assert status == 200, f"Bank creation failed: {res}"
        print("Chase Bank and Admin created successfully!")

    # 4. Login as Bank Admin
    print("\n4. Logging in as chaseadmin...")
    status, res = make_request(f"{BASE_URL}/api/users/login", method="POST", data={
        "username": "chaseadmin",
        "password": "chasepassword"
    })
    print(f"Status Code: {status}")
    assert status == 200, f"Bank Admin Login failed: {res}"
    bank_admin_token = res["access_token"]
    print("Bank Admin Login successful! Token acquired.")

    bank_headers = {"Authorization": f"Bearer {bank_admin_token}"}

    # 5. Bank Admin creates regular users user1 and user2
    print("\n5. Registering regular users under Chase Bank...")
    status, res = make_request(f"{BASE_URL}/api/banks/users", method="POST", data={
        "username": "user1",
        "email": "user1@chase.com",
        "whatsapp_number": "+919876543210",
        "password": "user1password"
    }, headers=bank_headers)
    print(f"User 1 Create Status: {status}")
    if status == 200:
        print(f"User 1 created. ID: {res['id']}")
    else:
        print(f"User 1 might already exist: {res}")
        
    status, res = make_request(f"{BASE_URL}/api/banks/users", method="POST", data={
        "username": "user2",
        "email": "user2@chase.com",
        "whatsapp_number": "+919876543211",
        "password": "user2password"
    }, headers=bank_headers)
    print(f"User 2 Create Status: {status}")
    if status == 200:
        print(f"User 2 created. ID: {res['id']}")
    else:
        print(f"User 2 might already exist: {res}")

    # Fetch users list to get IDs
    status, res = make_request(f"{BASE_URL}/api/banks/users", headers=bank_headers)
    users = res
    u1 = next(u for u in users if u["username"] == "user1")
    u2 = next(u for u in users if u["username"] == "user2")
    u1_id, u2_id = u1["id"], u2["id"]
    print(f"Resolved User IDs: user1={u1_id}, user2={u2_id}")

    # 6. Bank Admin creates a Device with User 1 & 2 configs, WhatsApp numbers, and notification toggles
    print("\n6. Creating Device Main Vault Camera with User 1 & 2 configs & WhatsApp numbers...")
    status, res = make_request(f"{BASE_URL}/api/devices/", method="POST", data={
        "name": "Main Vault Camera",
        "device_type": "ip_camera",
        "host": "127.0.0.1",
        "port": 554,
        "stream_path": "/stream1",
        "transport": "tcp",
        "assigned_user_id": u1_id,
        "assigned_user_2_id": u2_id,
        "whatsapp_number_1": "+919876543210",
        "whatsapp_number_2": "+919876543211",
        "enable_email": True,
        "enable_whatsapp": True
    }, headers=bank_headers)
    print(f"Device Create Status: {status}")
    assert status == 200, f"Device creation failed: {res}"
    device_id = res["id"]
    assert res.get("bank_id") is not None, "Device bank_id must not be None"
    assert res.get("assigned_user_id") == u1_id, "Device assigned_user_id must match u1_id"
    assert res.get("assigned_user_2_id") == u2_id, "Device assigned_user_2_id must match u2_id"
    assert res.get("whatsapp_number_1") == "+919876543210", "WhatsApp 1 mismatch"
    assert res.get("enable_email") is True, "Enable email must be True"
    assert res.get("enable_whatsapp") is True, "Enable whatsapp must be True"
    print(f"Device created: ID={device_id}, Bank={res['bank_id']}, User1={res['assigned_user_id']}, User2={res['assigned_user_2_id']}, WA1={res['whatsapp_number_1']}")

    # 7. Generate Single OTP for assigned device (verifying assigned user Email & WhatsApp delivery)
    print("\n7. Generating Single OTP for assigned device...")
    status, res = make_request(f"{BASE_URL}/api/camera/{device_id}/otp/generate", method="POST", headers=bank_headers)
    print(f"Single OTP Status: {status}")
    assert status == 200, f"Single OTP generation failed: {res}"
    print(f"  OTP Code: {res['code']}, Email Sent: {res.get('email_sent')}, WhatsApp Sent: {res.get('whatsapp_sent')}, Message: {res.get('message')}")

    # 8. Bank Admin triggers Dual OTP in NO THREAT mode (automatic resolution of assigned users)
    print("\n8. Triggering Dual OTP Send Action (automatic assigned user resolution)...")
    status, res = make_request(f"{BASE_URL}/api/camera/{device_id}/send-action", method="POST", data={
        "mode": "no_threat"
    }, headers=bank_headers)
    print(f"Send Action Status Code: {status}")
    assert status == 200, f"Send action failed: {res}"
    assert res["user1_username"] == u1["username"], f"Expected User 1 to default to assigned user {u1['username']}, got {res.get('user1_username')}"
    # 9. Verify Last Acknowledgment Endpoint
    print("\n9. Verifying Last Acknowledgment Endpoint...")
    status, res = make_request(f"{BASE_URL}/api/camera/{device_id}/last-acknowledgment", headers=bank_headers)
    print(f"Last Ack Status Code: {status}")
    assert status == 200, f"Last ack failed: {res}"
    assert res.get("has_ack") is True, f"Expected has_ack True, got {res}"
    print(f"  Last Ack Content: {res.get('content')}")

    # 10. Verify OTP Report Endpoint
    print("\n10. Verifying OTP Activity Report Endpoint...")
    status, res = make_request(f"{BASE_URL}/api/camera/{device_id}/otp-report", headers=bank_headers)
    print(f"OTP Report Status Code: {status}")
    assert status == 200, f"OTP report failed: {res}"
    assert res.get("total_records", 0) > 0, "Expected report to contain records"
    print(f"  Total Report Records: {res.get('total_records')}")

    print("\n=== Integration Flow Verification Complete: SUCCESS ===")

if __name__ == "__main__":
    test_flow()
