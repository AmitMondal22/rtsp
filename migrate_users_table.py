"""
Database migration script to remove UNIQUE constraint from users.email in SQLite and PostgreSQL.
"""
from app.database import engine
from sqlalchemy import text

def migrate_users_table():
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            db_type = engine.dialect.name
            print(f"Migrating users table for dialect '{db_type}'...")

            if db_type == "sqlite":
                # Check if email is unique in sqlite_master
                res = conn.execute(text("SELECT sql FROM sqlite_master WHERE type='table' AND name='users';")).fetchone()
                if res and "UNIQUE" in res[0].upper():
                    print("Removing UNIQUE constraint on email from SQLite users table...")
                    conn.execute(text("PRAGMA foreign_keys=OFF;"))
                    conn.execute(text("""
                        CREATE TABLE users_temp (
                            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                            username VARCHAR(100) NOT NULL UNIQUE,
                            email VARCHAR(100) NOT NULL,
                            whatsapp_number VARCHAR(20),
                            hashed_password VARCHAR(255) NOT NULL,
                            is_active BOOLEAN,
                            role VARCHAR(20),
                            bank_id INTEGER,
                            branch_id INTEGER,
                            created_at DATETIME,
                            updated_at DATETIME,
                            FOREIGN KEY(bank_id) REFERENCES banks (id),
                            FOREIGN KEY(branch_id) REFERENCES branches (id)
                        );
                    """))
                    conn.execute(text("INSERT INTO users_temp SELECT id, username, email, whatsapp_number, hashed_password, is_active, role, bank_id, branch_id, created_at, updated_at FROM users;"))
                    conn.execute(text("DROP TABLE users;"))
                    conn.execute(text("ALTER TABLE users_temp RENAME TO users;"))
                    conn.execute(text("CREATE INDEX IF EXISTS ix_users_username ON users (username);"))
                    conn.execute(text("CREATE INDEX IF EXISTS ix_users_email ON users (email);"))
                    conn.execute(text("PRAGMA foreign_keys=ON;"))
                    print("SQLite users table migration completed successfully!")
            elif db_type == "postgresql":
                conn.execute(text("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;"))
                conn.execute(text("DROP INDEX IF EXISTS ix_users_email;"))
                conn.execute(text("CREATE INDEX IF EXISTS ix_users_email ON users (email);"))
                print("PostgreSQL users table constraint dropped successfully!")

            trans.commit()
        except Exception as e:
            trans.rollback()
            print(f"Migration error: {e}")

if __name__ == "__main__":
    migrate_users_table()
