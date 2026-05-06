"""ADAPT-01..03 shape tests: prove @runtime_checkable Protocols accept duck-typed stubs."""
from adapters import ModelProvider, Integration, RuntimeAdapter


class _StubProvider:
    name = "stub-provider"

    async def complete(self, prompt: str, **kwargs) -> str:
        return "stub"

    async def health_check(self) -> bool:
        return True


class _StubIntegration:
    name = "stub-integration"

    async def send(self, channel: str, message: str, **kwargs) -> dict:
        return {"ok": True}

    async def health_check(self) -> bool:
        return True


class _StubRuntime:
    name = "stub-runtime"

    async def dispatch(self, agent_id: str, message: str, **kwargs):
        yield {"event": "stub"}

    async def health_check(self) -> bool:
        return True


class _MissingHealthCheck:
    name = "broken"

    async def complete(self, prompt: str, **kwargs) -> str:
        return ""


def test_model_provider_accepts_duck_typed_stub():
    assert isinstance(_StubProvider(), ModelProvider)


def test_integration_accepts_duck_typed_stub():
    assert isinstance(_StubIntegration(), Integration)


def test_runtime_adapter_accepts_duck_typed_stub():
    assert isinstance(_StubRuntime(), RuntimeAdapter)


def test_model_provider_rejects_incomplete_stub():
    assert not isinstance(_MissingHealthCheck(), ModelProvider)
