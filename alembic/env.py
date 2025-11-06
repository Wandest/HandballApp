from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# WICHTIG: Importiere deine Modelle aus database.py
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from backend.database import Base, SQLALCHEMY_DATABASE_URL

# Dies ist das Alembic Config-Objekt, das Zugriff auf die
# Werte in der .ini-Datei gibt.
config = context.config

# Setze die Datenbank-URL aus deiner database.py
# (überschreibt den Wert in alembic.ini)
config.set_main_option('sqlalchemy.url', SQLALCHEMY_DATABASE_URL)

# Interpretiere die config-Datei für Python-Logging.
# Diese Zeile stellt sicher, dass Logger nicht deaktiviert werden.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Füge dein Metadaten-Objekt hier hinzu
# für 'autogenerate'-Unterstützung.
# target_metadata = None
target_metadata = Base.metadata

# andere Konfigurationswerte von config, falls benötigt:
# my_important_option = config.get_main_option("my_important_option")
# ...


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

---
**Schritt 4: Erste Migration erstellen**
Jetzt, da Alembic deine Modelle kennt, sag ihm, es soll die *aktuelle* Datenbankstruktur (die, die wir in der letzten Sitzung erstellt haben) als "Version 1" speichern.

Führe diesen Befehl im Terminal aus:

```bash
alembic revision --autogenerate -m "Erstelle initiale Tabellenstruktur"
```

Das erstellt eine neue Datei im Ordner `alembic/versions/` (z.B. `..._erstelle_initiale_tabellenstruktur.py`).

**Schritt 5: Erste Migration anwenden**
Führe jetzt diesen Befehl aus, um diese Version in der Datenbank zu "stempeln".

```bash
alembic upgrade head