"""Direct-mode tests for the AgentArbiter escrow contract."""

import json

from tests.direct.conftest import to_hex

FUTURE = "2099-12-31T00:00:00Z"


def _llm_json(obj):
    # The direct runner json-decodes string mocks once, while GenVM v0.6's
    # exec_prompt(response_format="json") expects the raw JSON *text*, so
    # encode twice to hand the SDK the text a real LLM would return.
    return json.dumps(json.dumps(obj))


def _judge_mock(vm, approved=False, undetermined=False, reasoning="mock verdict"):
    vm.mock_llm(
        r".*impartial adjudicator.*",
        _llm_json(
            {
                "approved": approved,
                "undetermined": undetermined,
                "reasoning": reasoning,
            }
        ),
    )


# ----------------------------------------------------------------------
# create_task
# ----------------------------------------------------------------------


def test_create_task_requires_deposit(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice

    with direct_vm.expect_revert("Must deposit the task reward"):
        contract.create_task("t1", "build an API", "returns 200", FUTURE)


def test_create_task(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100

    contract.create_task("t1", "build an API", "returns 200", FUTURE)

    task = contract.get_task("t1")
    alice = to_hex(direct_alice)
    assert task["id"] == "t1"
    assert task["amount"] == 100
    assert task["requester"] == alice
    assert task["status"] == "CREATED"
    assert task["worker"] == "0x" + "00" * 20
    assert task["outcome"] == ""


def test_create_task_rejects_past_deadline(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100

    with direct_vm.expect_revert("Deadline must be in the future"):
        contract.create_task("t1", "spec", "criteria", "2000-01-01T00:00:00Z")


def test_create_task_rejects_duplicate(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)

    with direct_vm.expect_revert("Task already exists"):
        contract.create_task("t1", "spec", "criteria", FUTURE)


# ----------------------------------------------------------------------
# accept_task
# ----------------------------------------------------------------------


def test_accept_task_requires_matching_stake(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)

    direct_vm.sender = direct_bob
    direct_vm.value = 50
    with direct_vm.expect_revert("Stake must equal the task reward"):
        contract.accept_task("t1")


def test_accept_task(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)

    direct_vm.sender = direct_bob
    direct_vm.value = 100
    contract.accept_task("t1")

    task = contract.get_task("t1")
    assert task["status"] == "ASSIGNED"
    assert task["worker"] == to_hex(direct_bob)


def test_accept_task_rejects_after_deadline(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_arbiter.py")

    direct_vm.warp("2026-01-01T00:00:00Z")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", "2026-01-02T00:00:00Z")

    # Time passes beyond the deadline while the task is still unaccepted.
    direct_vm.warp("2026-01-03T00:00:00Z")
    direct_vm.sender = direct_bob
    direct_vm.value = 100
    with direct_vm.expect_revert("Task deadline has passed"):
        contract.accept_task("t1")# ----------------------------------------------------------------------
# submit_work
# ----------------------------------------------------------------------


def test_submit_work_only_worker(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)

    direct_vm.sender = direct_bob
    direct_vm.value = 100
    contract.accept_task("t1")

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only the worker can submit work"):
        contract.submit_work("t1", "done")


def test_submit_work(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)

    direct_vm.sender = direct_bob
    direct_vm.value = 100
    contract.accept_task("t1")
    contract.submit_work("t1", "https://github.com/worker/task")

    task = contract.get_task("t1")
    assert task["status"] == "SUBMITTED"
    assert task["evidence"] == "https://github.com/worker/task"


# ----------------------------------------------------------------------
# refund_unaccepted
# ----------------------------------------------------------------------


def test_refund_unaccepted(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_arbiter.py")

    direct_vm.warp("2026-01-01T00:00:00Z")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", "2026-01-02T00:00:00Z")

    # Deadline passes with no worker accepting.
    direct_vm.warp("2026-01-03T00:00:00Z")
    contract.refund_unaccepted("t1")

    task = contract.get_task("t1")
    assert task["status"] == "CANCELLED"


def test_refund_unaccepted_before_deadline_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)

    with direct_vm.expect_revert("Deadline has not passed yet"):
        contract.refund_unaccepted("t1")


def test_refund_unaccepted_wrong_caller_fails(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_arbiter.py")

    direct_vm.warp("2026-01-01T00:00:00Z")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", "2026-01-02T00:00:00Z")

    direct_vm.warp("2026-01-03T00:00:00Z")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the requester can refund"):
        contract.refund_unaccepted("t1")


# ----------------------------------------------------------------------
# settle (approved / rejected / undetermined)
# ----------------------------------------------------------------------


def test_settle_approves(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)

    direct_vm.sender = direct_bob
    direct_vm.value = 100
    contract.accept_task("t1")
    contract.submit_work("t1", "evidence")

    _judge_mock(direct_vm, approved=True)
    contract.settle("t1")

    task = contract.get_task("t1")
    assert task["status"] == "SETTLED"
    assert task["outcome"] == "APPROVED"


def test_settle_rejects(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)

    direct_vm.sender = direct_bob
    direct_vm.value = 100
    contract.accept_task("t1")
    contract.submit_work("t1", "evidence")

    _judge_mock(direct_vm, approved=False)
    contract.settle("t1")

    task = contract.get_task("t1")
    assert task["status"] == "SETTLED"
    assert task["outcome"] == "REJECTED"


def test_settle_undetermined(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)

    direct_vm.sender = direct_bob
    direct_vm.value = 100
    contract.accept_task("t1")
    contract.submit_work("t1", "evidence")

    _judge_mock(direct_vm, undetermined=True)
    contract.settle("t1")

    task = contract.get_task("t1")
    assert task["status"] == "SETTLED"
    assert task["outcome"] == "UNDETERMINED"


def test_settle_requires_submitted(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)

    with direct_vm.expect_revert("Task is not submitted"):
        contract.settle("t1")


# ----------------------------------------------------------------------
# consensus (leader / validator)
# ----------------------------------------------------------------------


def _submitted(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)
    direct_vm.sender = direct_bob
    direct_vm.value = 100
    contract.accept_task("t1")
    contract.submit_work("t1", "evidence")
    return contract


def test_settle_runs_through_validator_consensus(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _submitted(direct_vm, direct_deploy, direct_alice, direct_bob)
    _judge_mock(direct_vm, approved=True)
    contract.settle("t1")

    # A validator that independently reaches the same outcome agrees.
    assert direct_vm.run_validator() is True


def test_validator_ignores_reasoning_wording(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _submitted(direct_vm, direct_deploy, direct_alice, direct_bob)
    _judge_mock(direct_vm, approved=True)
    contract.settle("t1")

    direct_vm.clear_mocks()
    _judge_mock(direct_vm, approved=True, reasoning="different words")
    assert direct_vm.run_validator() is True


def test_validator_disagrees_on_different_outcome(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _submitted(direct_vm, direct_deploy, direct_alice, direct_bob)
    _judge_mock(direct_vm, approved=True)
    contract.settle("t1")

    # The validator's own LLM run says REJECTED -> no consensus.
    direct_vm.clear_mocks()
    _judge_mock(direct_vm, approved=False)
    assert direct_vm.run_validator() is False


def test_validator_rejects_invalid_leader_outcome(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _submitted(direct_vm, direct_deploy, direct_alice, direct_bob)
    _judge_mock(direct_vm, approved=True)
    contract.settle("t1")

    assert direct_vm.run_validator(leader_result={"outcome": "PAY_ME", "reasoning": "x"}) is False
    assert direct_vm.run_validator(leader_error=Exception("boom")) is False


def test_settle_reverts_on_malformed_llm_output(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _submitted(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.mock_llm(r".*impartial adjudicator.*", _llm_json({"verdict": "yes"}))

    with direct_vm.expect_revert("missing boolean decision fields"):
        contract.settle("t1")

    # Nothing was settled; the task can still be adjudicated later.
    assert contract.get_task("t1")["status"] == "SUBMITTED"


def test_settle_reverts_on_contradictory_verdict(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _submitted(direct_vm, direct_deploy, direct_alice, direct_bob)
    _judge_mock(direct_vm, approved=True, undetermined=True)

    with direct_vm.expect_revert("contradictory"):
        contract.settle("t1")
    assert contract.get_task("t1")["status"] == "SUBMITTED"


# ----------------------------------------------------------------------
# views
# ----------------------------------------------------------------------


def test_get_task_ids(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/agent_arbiter.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 100
    contract.create_task("t1", "spec", "criteria", FUTURE)
    contract.create_task("t2", "spec", "criteria", FUTURE)

    assert sorted(contract.get_task_ids()) == ["t1", "t2"]


def test_get_task_missing(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/agent_arbiter.py")
    with direct_vm.expect_revert("Task does not exist"):
        contract.get_task("nope")
