"""
Utility script to backfill/repair existing branches in ipcamera.db.
Ensures every branch has 3 distinct, unique users exclusive to that branch.
"""
from app.database import SessionLocal
from app.models.branch import Branch
from app.models.user import User
from app.services.auth_service import hash_password

def fix_branch_users():
    db = SessionLocal()
    try:
        branches = db.query(Branch).all()
        print(f"Found {len(branches)} branches to inspect and repair...")

        assigned_user_ids = set()

        for branch in branches:
            print(f"\n--- Checking Branch ID #{branch.id}: '{branch.name}' ---")

            # Check User 1
            u1 = db.query(User).filter(User.id == branch.user1_id).first() if branch.user1_id else None
            if not u1 or u1.id in assigned_user_ids:
                # Create brand new user for slot 1
                email = f"branch{branch.id}_user1@branch.local"
                u1 = User(
                    username=f"Branch_{branch.id}_User1",
                    email=email,
                    hashed_password=hash_password("user123456"),
                    role="user",
                    bank_id=branch.bank_id,
                    branch_id=branch.id,
                    is_active=True
                )
                db.add(u1)
                db.commit()
                db.refresh(u1)
                branch.user1_id = u1.id
            else:
                u1.branch_id = branch.id

            assigned_user_ids.add(u1.id)

            # Check User 2
            u2 = db.query(User).filter(User.id == branch.user2_id).first() if branch.user2_id else None
            if not u2 or u2.id in assigned_user_ids:
                email = f"branch{branch.id}_user2@branch.local"
                u2 = User(
                    username=f"Branch_{branch.id}_User2",
                    email=email,
                    hashed_password=hash_password("user123456"),
                    role="user",
                    bank_id=branch.bank_id,
                    branch_id=branch.id,
                    is_active=True
                )
                db.add(u2)
                db.commit()
                db.refresh(u2)
                branch.user2_id = u2.id
            else:
                u2.branch_id = branch.id

            assigned_user_ids.add(u2.id)

            # Check User 3
            u3 = db.query(User).filter(User.id == branch.user3_id).first() if branch.user3_id else None
            if not u3 or u3.id in assigned_user_ids:
                email = f"branch{branch.id}_user3@branch.local"
                u3 = User(
                    username=f"Branch_{branch.id}_User3",
                    email=email,
                    hashed_password=hash_password("user123456"),
                    role="user",
                    bank_id=branch.bank_id,
                    branch_id=branch.id,
                    is_active=True
                )
                db.add(u3)
                db.commit()
                db.refresh(u3)
                branch.user3_id = u3.id
            else:
                u3.branch_id = branch.id

            assigned_user_ids.add(u3.id)

            # Assign OTP users
            branch.otp1_user_id = u1.id
            branch.otp2_user_id = u2.id

            db.commit()
            print(f"  Branch #{branch.id} Users -> U1:{u1.id} ({u1.email}), U2:{u2.id} ({u2.email}), U3:{u3.id} ({u3.email})")

        print("\nDatabase repair completed successfully!")

    finally:
        db.close()

if __name__ == "__main__":
    fix_branch_users()
