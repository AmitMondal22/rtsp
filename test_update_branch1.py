"""
Test script to verify PUT /api/banks/branches/{branch_id} when user1, user2, user3 details are updated.
"""
from app.database import SessionLocal
from app.schemas.branch import BranchUpdate
from app.services.bank_service import update_branch_service, format_branch_out
from app.models.branch import Branch

def test_branch_update_payload():
    db = SessionLocal()
    try:
        branch = db.query(Branch).filter(Branch.id == 1).first()
        if not branch:
            branch = db.query(Branch).first()
        if not branch:
            print("No branches found in DB.")
            return

        print(f"\n--- Initial Branch #{branch.id} ('{branch.name}') ---")
        print(f"  User 1 ID: {branch.user1_id}, User 2 ID: {branch.user2_id}, User 3 ID: {branch.user3_id}")

        update_payload = BranchUpdate(
            bank_id=branch.bank_id or 1,
            name="kolkata1",
            is_active=True,
            enable_otp1=True,
            enable_otp2=True,
            user1_username="Amit Mdfve",
            user1_email="jnjwwed@gmail.com",
            user1_password=None,
            user1_whatsapp="7384736474",
            user1_active=True,
            user2_username="Amit Mbdef",
            user2_email="zje56ddd@gmail.com",
            user2_password=None,
            user2_whatsapp="7384736479",
            user2_active=True,
            user3_username="Amit zsedfve",
            user3_email="asvbtdvr@gmail.com",
            user3_password=None,
            user3_whatsapp="7384736475",
            user3_active=True,
        )

        res = update_branch_service(db, branch.id, update_payload)

        print(f"\n--- Updated Branch #{res['id']} ('{res['name']}') ---")
        print(f"  User 1 ID: {res['user1_id']}, Name: {res['user1_name']}, Email: {res['user1_email']}, WA: {res['user1_whatsapp']}")
        print(f"  User 2 ID: {res['user2_id']}, Name: {res['user2_name']}, Email: {res['user2_email']}, WA: {res['user2_whatsapp']}")
        print(f"  User 3 ID: {res['user3_id']}, Name: {res['user3_name']}, Email: {res['user3_email']}, WA: {res['user3_whatsapp']}")

        assert res['user1_id'] != res['user2_id'], "User 1 and User 2 must have distinct IDs!"
        assert res['user2_id'] != res['user3_id'], "User 2 and User 3 must have distinct IDs!"
        assert res['user1_id'] != res['user3_id'], "User 1 and User 3 must have distinct IDs!"

        assert res['user1_name'] == "Amit Mdfve", f"Expected 'Amit Mdfve', got {res['user1_name']}"
        assert res['user2_name'] == "Amit Mbdef", f"Expected 'Amit Mbdef', got {res['user2_name']}"
        assert res['user3_name'] == "Amit zsedfve", f"Expected 'Amit zsedfve', got {res['user3_name']}"

        assert res['user1_email'] == "jnjwwed@gmail.com"
        assert res['user2_email'] == "zje56ddd@gmail.com"
        assert res['user3_email'] == "asvbtdvr@gmail.com"

        print("\n=== Branch Update Payload Test PASSED! All 3 user slots successfully updated with distinct user IDs! ===")

    finally:
        db.close()

if __name__ == "__main__":
    test_branch_update_payload()
