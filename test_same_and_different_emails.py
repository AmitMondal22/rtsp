"""
Test script to verify creating and updating branch users with SAME or DIFFERENT email addresses.
"""
from app.database import SessionLocal
from app.schemas.branch import BranchCreate, BranchUpdate
from app.services.bank_service import create_branch_service, update_branch_service
from app.models.bank import Bank

def test_same_and_different():
    db = SessionLocal()
    try:
        bank = db.query(Bank).first()
        if not bank:
            bank = Bank(name="Test Bank")
            db.add(bank)
            db.commit()
            db.refresh(bank)

        print("\n--- 1. Testing Create Branch with SAME email for User 1 & User 2 ---")
        create_data = BranchCreate(
            name="Same Email Branch",
            bank_id=bank.id,
            is_active=True,
            user1_username="SameEmailUser1",
            user1_email="shared_mgr@bank.com",
            user1_password="Pass1234!",
            user2_username="SameEmailUser2",
            user2_email="shared_mgr@bank.com",  # SAME email
            user2_password="Pass1234!",
            user3_username="DifferentEmailUser3",
            user3_email="different_officer@bank.com", # DIFFERENT email
            user3_password="Pass1234!",
        )

        res = create_branch_service(db, create_data)
        print(f"Created Branch #{res['id']} '{res['name']}':")
        print(f"  User 1: {res['user1_name']} <{res['user1_email']}>")
        print(f"  User 2: {res['user2_name']} <{res['user2_email']}>")
        print(f"  User 3: {res['user3_name']} <{res['user3_email']}>")

        assert res['user1_email'] == "shared_mgr@bank.com"
        assert res['user2_email'] == "shared_mgr@bank.com"
        assert res['user3_email'] == "different_officer@bank.com"

        print("\n--- 2. Testing Update Branch users with SAME and DIFFERENT emails ---")
        update_data = BranchUpdate(
            name="Same Email Branch Updated",
            user1_username="SameEmailUser1_Updated",
            user1_email="all_same@bank.com",  # Update to same email for all 3
            user2_username="SameEmailUser2_Updated",
            user2_email="all_same@bank.com",  # Update to same email for all 3
            user3_username="DifferentEmailUser3_Updated",
            user3_email="all_same@bank.com",  # Update to same email for all 3
        )

        updated_res = update_branch_service(db, res['id'], update_data)
        print(f"Updated Branch #{updated_res['id']} '{updated_res['name']}':")
        print(f"  User 1: {updated_res['user1_name']} <{updated_res['user1_email']}>")
        print(f"  User 2: {updated_res['user2_name']} <{updated_res['user2_email']}>")
        print(f"  User 3: {updated_res['user3_name']} <{updated_res['user3_email']}>")

        assert updated_res['user1_email'] == "all_same@bank.com"
        assert updated_res['user2_email'] == "all_same@bank.com"
        assert updated_res['user3_email'] == "all_same@bank.com"

        print("\n=== All SAME and DIFFERENT Email Branch Tests PASSED! ===")
    finally:
        db.close()

if __name__ == "__main__":
    test_same_and_different()
