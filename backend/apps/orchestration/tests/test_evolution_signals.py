from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.core.organizations import ensure_current_organization
from apps.orchestration.evolution_signals import record_run_signals
from apps.orchestration.models import SopDefinition, SopEvolutionSignal, SopNodeRun, SopRun, SopVersion
from apps.orchestration.sop_schema import graph_hash, validate_graph


class EvolutionSignalTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="evo_user", password="pass")
        self.org = ensure_current_organization(self.user)
        graph = validate_graph(
            {
                "start": "collect.scope",
                "terminals": ["finish"],
                "nodes": [
                    {
                        "key": "collect.scope",
                        "type": "collect_info",
                        "title": "采集",
                        "config": {"instruction": "采集", "required_fields": ["品牌"]},
                    },
                    {"key": "finish", "type": "end", "title": "结束", "config": {}},
                ],
                "edges": [{"source": "collect.scope", "target": "finish", "condition": "always", "priority": 1}],
            }
        )
        self.sop = SopDefinition.objects.create(
            organization=self.org,
            sop_key="evo.test",
            name="进化测试",
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

    def test_trial_run_does_not_record_signals(self):
        run = SopRun.objects.create(
            trace_id="trial-signal-1",
            version=self.version,
            organization=self.org,
            user=self.user,
            status=SopRun.Status.NEED_INPUT,
            is_trial=True,
            source=SopRun.Source.TRIAL,
            current_node="collect.scope",
            missing_fields=["品牌"],
        )
        tags = record_run_signals(run)
        self.assertIn("need_input", tags)
        self.assertTrue(SopEvolutionSignal.objects.filter(definition=self.sop).exists())
        signal = SopEvolutionSignal.objects.filter(definition=self.sop).first()
        self.assertTrue((signal.payload_summary or {}).get("from_trial"))

    def test_live_need_input_records_signals(self):
        run = SopRun.objects.create(
            trace_id="live-signal-1",
            version=self.version,
            organization=self.org,
            user=self.user,
            status=SopRun.Status.NEED_INPUT,
            is_trial=False,
            source=SopRun.Source.LIVE,
            current_node="collect.scope",
            missing_fields=["品牌"],
        )
        SopNodeRun.objects.create(
            run=run,
            sequence=1,
            node_key="collect.scope",
            node_type="collect_info",
            title="采集",
            status=SopNodeRun.Status.NEED_INPUT,
        )
        tags = record_run_signals(run)
        self.assertIn("need_input", tags)
        signals = list(SopEvolutionSignal.objects.filter(definition=self.sop))
        types = {row.signal_type for row in signals}
        self.assertIn(SopEvolutionSignal.SignalType.NEED_INPUT_LOOP, types)
        self.assertIn(SopEvolutionSignal.SignalType.MISSING_FIELD_REPEAT, types)
