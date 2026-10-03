import os
import secrets
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AEGIS_", env_file=".env", extra="ignore")
    data_dir: Path = Path(".data")
    local_mode: bool = True
    container_local_session: bool = False
    api_token: str = ""
    api_token_file: str = ""
    origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8088,http://127.0.0.1:8088"
    postgres_env: str = ""
    kube_enabled: bool = False
    kube_namespace: str = "aegisdr-demo"
    kube_deployment: str = "demo-app"
    operation_timeout: int = 120
    scheduler_interval: float = 5

    def prepare(self):
        self.data_dir = self.data_dir.resolve()
        for name in ("backups", "protected", "scratch"):
            (self.data_dir / name).mkdir(parents=True, exist_ok=True)
        if not self.local_mode and not self.api_token:
            if not self.api_token_file:
                raise RuntimeError("AEGIS_API_TOKEN or AEGIS_API_TOKEN_FILE is required when local mode is disabled")
        if self.api_token_file:
            self.api_token = Path(self.api_token_file).read_text().strip()
            if len(self.api_token) < 32:
                raise RuntimeError("API token file must contain at least 32 characters")
        if not self.local_mode and len(self.api_token) < 32:
            raise RuntimeError("Remote API token must contain at least 32 characters")
        for key, value in list(os.environ.items()):
            if key.startswith("AEGIS_DB_") and key.endswith("_FILE"):
                os.environ[key.removesuffix("_FILE")] = Path(value).read_text().strip()
        if not self.api_token:
            path = self.data_dir / "api-token"
            if not path.exists():
                path.write_text(secrets.token_urlsafe(48))
                if os.name != "nt":
                    path.chmod(0o600)
            self.api_token = path.read_text().strip()


settings = Settings()
