from django.test import TestCase, override_settings

from apps.orchestration.evolution_extras import (
    build_skill_package_from_handoff,
    detect_unused_branches,
)
from apps.orchestration.models import SopDefinition, SopRun, SopVersion
from apps.orchestration.sop_runtime import _parse_retry_policy
from apps.orchestration.sop_schema import graph_hash, validate_graph


class RetryPolicyTests(TestCase):
    def test_default_no_retry(self):
        attempts, on_failure = _parse_retry_policy({})
        self.assertEqual(attempts, 1)
        self.assertEqual(on_failure, "fail")

    def test_reads_retry_config(self):
        attempts, on_failure = _parse_retry_policy({
            "retry": {"max_attempts": 3, "on_failure": "checkpoint"},
        })
        self.assertEqual(attempts, 3)
        self.assertEqual(on_failure, "checkpoint")


class SkillPackageScaffoldTests(TestCase):
    def test_builds_zip_with_scripts_without_llm(self):
        skill_id, filename, data = build_skill_package_from_handoff(
            sop_name="测试流程",
            node_key="handoff.review",
            error="缺少审批人",
            count=4,
            user=None,
        )
        self.assertTrue(filename.endswith(".zip"))
        self.assertTrue(skill_id)
        self.assertGreater(len(data), 100)

        import io
        import zipfile

        with zipfile.ZipFile(io.BytesIO(data)) as package:
            names = package.namelist()
        self.assertTrue(any(name.lower().endswith("skill.md") for name in names))
        self.assertTrue(any("scripts/run.py" in name for name in names))


@override_settings(SOP_EVOLUTION_UNUSED_BRANCH_MIN_RUNS=5)
class UnusedBranchThresholdTests(TestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model
        from apps.core.organizations import ensure_current_organization

        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="branch_user", password="pass")
        self.org = ensure_current_organization(self.user)
        graph = validate_graph({
            "start": "gate",
            "terminals": ["end.ok", "end.fail"],
            "nodes": [
                {"key": "gate", "type": "gate", "title": "判断", "config": {"action_name": "report.generate"}},
                {"key": "end.ok", "type": "end", "title": "成功", "config": {}},
                {"key": "end.fail", "type": "end", "title": "失败", "config": {}},
            ],
            "edges": [
                {"source": "gate", "target": "end.ok", "condition": "result_ok", "priority": 1},
                {"source": "gate", "target": "end.fail", "condition": "result_failed", "priority": 2},
            ],
        })
        self.sop = SopDefinition.objects.create(
            organization=self.org,
            sop_key="branch.test",
            name="分支测试",
            created_by=self.user,
            updated_by=self.user,
        )
        self.version = SopVersion.objects.create(
            definition=self.sop,
            version="1.0.0",
            graph=graph,
            content_hash=graph_hash(
                graph=graph, input_schema={}, output_schema={}, trigger_intents=[], examples=[]
            ),
            created_by=self.user,
        )

    def test_requires_min_runs_before_proposing(self):
        for index in range(4):
            SopRun.objects.create(
                trace_id=f"branch-run-{index}",
                version=self.version,
                organization=self.org,
                user=self.user,
                status=SopRun.Status.COMPLETED,
            )
        self.assertEqual(detect_unused_branches(self.version), [])

        SopRun.objects.create(
            trace_id="branch-run-5",
            version=self.version,
            organization=self.org,
            user=self.user,
            status=SopRun.Status.COMPLETED,
        )
        # Enough runs to pass threshold; without node-run visits this stays empty.
        self.assertEqual(detect_unused_branches(self.version), [])
