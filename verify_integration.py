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
            try:
                parsed = json.loads(res_data) if res_data else {}
            except Exception:
                parsed = res_data
            return response.status, parsed
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

    # 2. Login as superadmin using email
    print("\n2. Logging in as superadmin...")
    status, res = make_request(f"{BASE_URL}/api/users/login", method="POST", data={
        "email": "superadmin@example.com",
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

    # 3. Superadmin creates Bank and Bank Admin with full name username
    print("\n3. Creating Chase Bank and Admin...")
    status, res = make_request(f"{BASE_URL}/api/banks/", method="POST", data={
        "bank_name": "Chase Bank",
        "username": "Chase Admin User",
        "email": "chaseadmin@example.com",
        "password": "chasepassword"
    }, headers=super_headers)
    print(f"Status Code: {status}")
    if status == 400 and "already exists" in str(res):
        print("Bank already exists. Fetching bank list...")
        status, banks = make_request(f"{BASE_URL}/api/banks/", headers=super_headers)
        bank_id = banks[0]["id"]
    else:
        assert status == 200, f"Bank creation failed: {res}"
        bank_id = res["id"]
        print(f"Chase Bank and Admin created successfully! Bank ID={bank_id}")

    # 4. Login as Bank Admin using email
    print("\n4. Logging in as chaseadmin via email...")
    status, res = make_request(f"{BASE_URL}/api/users/login", method="POST", data={
        "email": "chaseadmin@example.com",
        "password": "chasepassword"
    })
    print(f"Status Code: {status}")
    assert status == 200, f"Bank Admin Login failed: {res}"
    bank_admin_token = res["access_token"]
    print("Bank Admin Login successful! Token acquired.")

    bank_headers = {"Authorization": f"Bearer {bank_admin_token}"}

    # 5. Bank Admin creates regular users including Amit Mondal
    print("\n5. Registering regular users under Chase Bank including Amit Mondal...")
    status, res = make_request(f"{BASE_URL}/api/banks/users", method="POST", data={
        "username": "Amit Mondal",
        "email": "amit.mondal@example.com",
        "whatsapp_number": "+919876543219",
        "password": "userpassword123"
    }, headers=bank_headers)
    print(f"Amit Mondal Create Status: {status}")

    # Test login for Amit Mondal using email
    status, res = make_request(f"{BASE_URL}/api/users/login", method="POST", data={
        "email": "amit.mondal@example.com",
        "password": "userpassword123"
    })
    print(f"Amit Mondal Email Login Status Code: {status}")
    assert status == 200, f"Amit Mondal login failed: {res}"

    # Test updating user 7 with Amit Mondal
    print("\n5b. Testing PUT /api/banks/users/7 with Amit Mondal...")
    status, res = make_request(f"{BASE_URL}/api/banks/users/7", method="PUT", data={
        "username": "Amit Mondal",
        "email": "user1@chase.com",
        "whatsapp_number": "+919876543210",
        "role": "user",
        "bank_id": 1,
        "branch_id": 6,
        "is_active": True
    }, headers=bank_headers)
    print(f"Update User 7 Status: {status}")
    assert status in [200, 404], f"User update failed: {res}"

    # Fetch users list to get IDs
    status, users_res = make_request(f"{BASE_URL}/api/banks/users", headers=bank_headers)
    users_list = users_res if isinstance(users_res, list) else []
    u1 = next((u for u in users_list if isinstance(u, dict) and u.get("email") == "user1@chase.com"), None)
    u2 = next((u for u in users_list if isinstance(u, dict) and u.get("email") == "user2@chase.com"), None)
    u3 = next((u for u in users_list if isinstance(u, dict) and u.get("email") == "user3@chase.com"), u1)
    u1_id = u1["id"] if u1 else 4
    u2_id = u2["id"] if u2 else 5
    u3_id = u3["id"] if u3 else 6
    print(f"Resolved User IDs: user1={u1_id}, user2={u2_id}, user3={u3_id}")

    # 6. Create Branch under Bank with 3 brand-new unique users
    print("\n6. Creating Branch under Chase Bank with 3 new users...")
    import time
    ts = int(time.time())
    status, res = make_request(f"{BASE_URL}/api/banks/branches", method="POST", data={
        "name": "Downtown Vault Branch",
        "bank_id": bank_id,
        "is_active": True,
        "user1_username": "Branch User One",
        "user1_email": f"branch1_u1_{ts}@chase.com",
        "user1_password": "Pass1234!",
        "user1_whatsapp": "+919000000001",
        "user1_active": True,
        "user2_username": "Branch User Two",
        "user2_email": f"branch1_u2_{ts}@chase.com",
        "user2_password": "Pass1234!",
        "user2_whatsapp": "+919000000002",
        "user2_active": True,
        "user3_username": "Branch User Three",
        "user3_email": f"branch1_u3_{ts}@chase.com",
        "user3_password": "Pass1234!",
        "user3_whatsapp": "+919000000003",
        "user3_active": True,
    }, headers=bank_headers)
    print(f"Branch Create Status Code: {status}")
    assert status == 200, f"Branch creation failed: {res}"
    branch_id = res["id"]
    assert res["name"] == "Downtown Vault Branch"
    assert res["is_active"] is True
    assert res["user1_id"] is not None, "user1_id should be set"
    assert res["user1_name"] == "Branch User One"
    assert res["user1_email"] == f"branch1_u1_{ts}@chase.com"
    assert res["user2_id"] is not None, "user2_id should be set"
    assert res["user3_id"] is not None, "user3_id should be set"
    print(f"Branch created successfully! Branch ID={branch_id}, User1={res['user1_name']} <{res['user1_email']}>")


    # 6b. Test updating branch and users (update the branch's own users)
    print("\n6b. Updating Branch & Users via PUT /api/banks/branches/{branch_id}...")
    status, update_res = make_request(f"{BASE_URL}/api/banks/branches/{branch_id}", method="PUT", data={
        "name": "Downtown Main Vault Branch",
        "bank_id": bank_id,
        "is_active": True,
        "user1_username": "Branch User One Updated",
        "user1_email": f"branch1_u1_{ts}@chase.com",
        "user1_whatsapp": "+919876543210",
        "user1_active": True,
        "user2_username": "Branch User Two Updated",
        "user2_email": f"branch1_u2_{ts}@chase.com",
        "user2_whatsapp": "+919876543211",
        "user2_active": True,
        "user3_username": "Branch User Three Updated",
        "user3_email": f"branch1_u3_{ts}@chase.com",
        "user3_whatsapp": "+919876543212",
        "user3_active": True
    }, headers=bank_headers)
    print(f"Branch Update Status Code: {status}")
    assert status == 200, f"Branch update failed: {update_res}"
    assert update_res["name"] == "Downtown Main Vault Branch"
    assert update_res["user1_name"].startswith("Branch User One Updated")
    assert update_res["user1_email"] == f"branch1_u1_{ts}@chase.com"
    print(f"Branch and users updated successfully! User1={update_res['user1_name']}")

    # 7. Bank Admin creates a Device with Bank ID and Branch ID selection
    print("\n7. Creating Device Main Vault Camera with Bank & Branch selection...")
    status, res = make_request(f"{BASE_URL}/api/devices/", method="POST", data={
        "name": "Main Vault Camera",
        "device_type": "ip_camera",
        "host": "127.0.0.1",
        "port": 554,
        "stream_path": "/stream1",
        "transport": "tcp",
        "bank_id": bank_id,
        "branch_id": branch_id,
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
    assert res.get("bank_id") == bank_id, "Device bank_id must match"
    assert res.get("branch_id") == branch_id, "Device branch_id must match"
    print(f"Device created: ID={device_id}, Bank={res['bank_id']}, Branch={res['branch_id']}")

    # 8. Generate Single OTP for assigned device
    print("\n8. Generating Single OTP for assigned device...")
    status, res = make_request(f"{BASE_URL}/api/camera/{device_id}/otp/generate", method="POST", headers=bank_headers)
    print(f"Single OTP Status: {status}")
    assert status == 200, f"Single OTP generation failed: {res}"
    print(f"  OTP Code: {res['code']}, Email Sent: {res.get('email_sent')}, WhatsApp Sent: {res.get('whatsapp_sent')}, Message: {res.get('message')}")

    # 9. Bank Admin triggers Dual OTP in NO THREAT mode
    print("\n9. Triggering Dual OTP Send Action...")
    status, res = make_request(f"{BASE_URL}/api/camera/{device_id}/send-action", method="POST", data={
        "mode": "no_threat"
    }, headers=bank_headers)
    print(f"Send Action Status Code: {status}")
    assert status == 200, f"Send action failed: {res}"
    assert res["user1_username"].startswith("Branch User One Updated") or res["user1_username"] == u1["username"], f"Expected Branch User 1 or {u1['username']}, got {res.get('user1_username')}"

    # 10. Verify Last Acknowledgment Endpoint
    print("\n10. Verifying Last Acknowledgment Endpoint...")
    status, res = make_request(f"{BASE_URL}/api/camera/{device_id}/last-acknowledgment", headers=bank_headers)
    print(f"Last Ack Status Code: {status}")
    assert status == 200, f"Last ack failed: {res}"
    assert res.get("has_ack") is True, f"Expected has_ack True, got {res}"
    print(f"  Last Ack Content: {res.get('content')}")

    # 11. Verify OTP Report Endpoint
    print("\n11. Verifying OTP Activity Report Endpoint...")
    status, res = make_request(f"{BASE_URL}/api/camera/{device_id}/otp-report", headers=bank_headers)
    print(f"OTP Report Status Code: {status}")
    assert status == 200, f"OTP report failed: {res}"
    assert res.get("total_records", 0) > 0, "Expected report to contain records"
    print(f"  Total Report Records: {res.get('total_records')}")

    # 12. Verify /branches Page Route
    print("\n12. Verifying /branches Page Route...")
    status, res = make_request(f"{BASE_URL}/branches")
    print(f"Branches HTML Status Code: {status}")
    assert status == 200, f"Expected 200 OK for /branches page, got {status}"
    print("  /branches HTML page loaded successfully!")

    print("\n=== Integration Flow Verification Complete: SUCCESS ===")

if __name__ == "__main__":
    test_flow()

