"""ai_autopilot_tasks #4: registry invariants + guardrail gate."""
import pytest

from app.services.autopilot_registry import (
    ACTION_REGISTRY,
    PROHIBITED_ACTION_TYPES,
    PayloadValidationError,
    ProhibitedActionError,
    UnknownActionError,
    check_action_allowed,
    validate_payload,
)


def test_auto_capable_implies_reversible_low_risk():
    for spec in ACTION_REGISTRY.values():
        if spec.auto_capable:
            assert spec.reversible, spec.action_type
            assert spec.risk == "low", spec.action_type


def test_migration_execute_is_never_auto_capable():
    spec = ACTION_REGISTRY["migration_execute"]
    assert spec.auto_capable is False
    assert spec.reversible is False
    assert spec.risk == "high"


@pytest.mark.parametrize("action_type", sorted(PROHIBITED_ACTION_TYPES))
def test_prohibited_types_raise(action_type):
    with pytest.raises(ProhibitedActionError) as e:
        check_action_allowed(action_type)
    assert "regardless of policy" in str(e.value)


def test_unknown_type_default_denied():
    with pytest.raises(UnknownActionError):
        check_action_allowed("format_all_disks")


def test_registered_types_pass():
    for action_type in ACTION_REGISTRY:
        assert check_action_allowed(action_type).action_type == action_type


def test_no_prohibited_type_is_registered():
    assert not PROHIBITED_ACTION_TYPES & set(ACTION_REGISTRY)


def test_validate_payload_missing_key():
    spec = ACTION_REGISTRY["connector_health_check"]
    with pytest.raises(PayloadValidationError):
        validate_payload(spec, {})


def test_validate_payload_coerces_ids():
    spec = ACTION_REGISTRY["connector_health_check"]
    assert validate_payload(spec, {"connection_id": "7"}) == {"connection_id": 7}
    with pytest.raises(PayloadValidationError):
        validate_payload(spec, {"connection_id": "not-a-number"})
