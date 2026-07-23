from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from unittest.mock import patch

from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom
from apps.collab.xiaoce_sop import (
    bound_sop_keys,
    extract_slots_from_text,
    format_sop_reply,
    looks_like_sop_run_intent,
    match_bound_sop_version,
    resolve_xiaoce_agent,
    try_handle_xiaoce_sop,
)
from apps.core.organizations import ensure_current_organization
from apps.council.models import AgentProfile
from apps.orchestration.models import SopDefinition, SopVersion
from apps.orchestration.sop_schema import graph_hash, validate_graph


class XiaoceSopParseTests(SimpleTestCase):
    def test_extract_unove_date_range(self):
        slots = extract_slots_from_text(
            "获取 Unove 7.6-7.16 天猫销售明细，按照模版汇总趋势与重点单品。",
            ["date_range", "brand"],
        )
        self.assertEqual(slots.get("brand"), "Unove")
        self.assertEqual(slots.get("date_range"), "7.6-7.16")

    def test_need_input_reply_is_human(self):
        version = SopVersion(
            version="v1",
            graph={
                "nodes": [
                    {
                        "key": "collect.info",
                        "type": "collect_info",
                        "title": "确认日期与品牌",
                        "config": {
                            "instruction": "请提供统计日期范围和品牌。",
                            "expected_user_info": ["date_range", "brand"],
                        },
                    }
                ]
            },
        )
        version.definition = SopDefinition(name="天猫销售周报（本地版）", sop_key="x")
        text = format_sop_reply(
            version=version,
            result={"decision": "need_input", "missing": ["date_range", "brand"], "result": {}},
        )
        self.assertIn("统计日期范围", text)
        self.assertIn("品牌", text)
        self.assertNotIn("date_range", text)
        self.assertNotIn("run `", text)


class XiaoceSopBindingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("sop-xiaoce-user", password="pw")
        self.org = ensure_current_organization(self.user)

        graph = validate_graph(
            {
                "start": "collect.info",
                "terminals": ["finish"],
                "nodes": [
                    {
                        "key": "collect.info",
                        "type": "collect_info",
                        "title": "确认日期与品牌",
                        "config": {
                            "instruction": "请提供统计日期范围和品牌。",
                            "expected_user_info": ["date_range", "brand"],
                        },
                    },
                    {"key": "finish", "type": "end", "title": "结束", "config": {}},
                ],
                "edges": [
                    {"source": "collect.info", "target": "finish", "condition": "always", "priority": 1},
                ],
            }
        )
        self.definition = SopDefinition.objects.create(
            sop_key="tmall_sales_weekly_local",
            organization=self.org,
            name="天猫销售周报（本地版）",
            action_name="tmall_sales_weekly_local",
            status=SopDefinition.Status.PUBLISHED,
            current_version="v1",
            created_by=self.user,
            updated_by=self.user,
        )
        self.version = SopVersion.objects.create(
            definition=self.definition,
            version="v1",
            status=SopVersion.Status.PUBLISHED,
            graph=graph,
            content_hash=graph_hash(
                graph=graph, input_schema={}, output_schema={}, trigger_intents=[], examples=[]
            ),
            utterance_examples=["跑一下天猫销售周报", "出一份天猫周报"],
            created_by=self.user,
            published_by=self.user,
        )
        self.agent = AgentProfile.objects.create(
            organization=self.org,
            name="小策",
            employee_code="xiaoce",
            sop_keys=["tmall_sales_weekly_local"],
            created_by=self.user,
            owner=self.user,
        )
        self.room = CollabRoom.objects.create(created_by=self.user, room_kind="dm", title="小策")
        CollabParticipant.objects.create(room=self.room, user=self.user)

    def test_resolve_xiaoce_agent_by_code(self):
        found = resolve_xiaoce_agent(self.org)
        self.assertEqual(found.id, self.agent.id)
        self.assertEqual(bound_sop_keys(found), ["tmall_sales_weekly_local"])

    def test_looks_like_sop_run_intent(self):
        self.assertTrue(looks_like_sop_run_intent("跑一下天猫销售周报（本地版）"))
        self.assertTrue(looks_like_sop_run_intent("sop:tmall_sales_weekly_local"))
        self.assertTrue(looks_like_sop_run_intent("获取 Unove 7.6-7.16 天猫销售明细"))
        self.assertFalse(looks_like_sop_run_intent("今天天气怎么样"))

    def test_match_by_name_within_allowlist(self):
        matched = match_bound_sop_version(
            text="帮我跑一下天猫销售周报（本地版）",
            versions=[self.version],
            organization=self.org,
            user=self.user,
        )
        self.assertEqual(matched.id, self.version.id)

    @patch("apps.collab.xiaoce_sop.interpret_xiaoce_turn_with_llm", return_value=None)
    def test_try_handle_unbound_explains_binding(self, _llm_mock):
        self.agent.sop_keys = []
        self.agent.save(update_fields=["sop_keys"])
        result = try_handle_xiaoce_sop(
            user=self.user,
            room=self.room,
            text="跑一下天猫销售周报（本地版）",
        )
        self.assertIsNotNone(result)
        self.assertIn("绑定", result["reply"])
        self.assertTrue(result["meta"].get("sop_unbound"))

    @patch("apps.collab.xiaoce_sop.interpret_xiaoce_turn_with_llm", return_value=None)
    @patch("apps.collab.xiaoce_sop.execute_sop_version")
    def test_try_handle_runs_bound_sop_with_extracted_slots(self, execute_mock, _llm_mock):
        execute_mock.return_value = {
            "decision": "allow",
            "steps": [],
            "sop": {"run_id": "run-1", "key": "tmall_sales_weekly_local", "version": "v1"},
            "missing": [],
            "error": None,
            "result": {"report_markdown": "# 周报\nUnove 销售概况"},
        }
        result = try_handle_xiaoce_sop(
            user=self.user,
            room=self.room,
            text="获取 Unove 7.6-7.16 天猫销售明细，按照模版汇总趋势与重点单品。",
        )
        self.assertIsNotNone(result)
        self.assertIn("周报", result["reply"])
        self.assertNotIn("run `", result["reply"])
        payload = execute_mock.call_args.kwargs["payload"]
        self.assertEqual(payload.get("brand"), "Unove")
        self.assertEqual(payload.get("date_range"), "7.6-7.16")

    @patch("apps.collab.xiaoce_sop.interpret_xiaoce_turn_with_llm", return_value=None)
    @patch("apps.collab.xiaoce_sop.execute_sop_version")
    def test_pending_followup_resumes_even_without_confirm_keyword(self, execute_mock, _llm_mock):
        execute_mock.return_value = {
            "decision": "allow",
            "steps": [],
            "sop": {"run_id": "run-2"},
            "missing": [],
            "result": {"user_message": "已按 Unove 生成周报"},
        }
        CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="pending",
            msg_type="ai",
            ai_kind="xiaoce",
            meta={
                "sop_pending": {
                    "sop_key": "tmall_sales_weekly_local",
                    "version": "v1",
                    "trace_id": "xiaoce-sop-resume",
                    "missing": ["date_range", "brand"],
                    "payload": {"_sop_key": "tmall_sales_weekly_local"},
                }
            },
        )
        result = try_handle_xiaoce_sop(
            user=self.user,
            room=self.room,
            text="获取 Unove 7.6-7.16 天猫销售明细，按照模版汇总趋势与重点单品。",
        )
        self.assertIsNotNone(result)
        self.assertIn("Unove", result["reply"])
        payload = execute_mock.call_args.kwargs["payload"]
        self.assertEqual(payload.get("brand"), "Unove")
        self.assertEqual(payload.get("date_range"), "7.6-7.16")
        self.assertEqual(execute_mock.call_args.kwargs["trace_id"], "xiaoce-sop-resume")

    @patch("apps.collab.xiaoce_sop.execute_sop_version")
    def test_llm_judge_drives_run(self, execute_mock):
        execute_mock.return_value = {
            "decision": "allow",
            "result": {"report_markdown": "LLM 驱动周报"},
            "sop": {"run_id": "r3"},
            "missing": [],
        }
        with patch(
            "apps.collab.xiaoce_sop.interpret_xiaoce_turn_with_llm",
            return_value={
                "intent": "run_sop",
                "sop_key": "tmall_sales_weekly_local",
                "slots": {"brand": "Unove", "date_range": "7.6-7.16"},
                "confirm": False,
                "reason": "用户要周报",
                "source": "llm",
            },
        ):
            result = try_handle_xiaoce_sop(
                user=self.user,
                room=self.room,
                text="随便说一句也能被模型判成跑周报",
            )
        self.assertIsNotNone(result)
        self.assertIn("周报", result["reply"])
        self.assertEqual(result["meta"]["sop_judge"]["source"], "llm")
        payload = execute_mock.call_args.kwargs["payload"]
        self.assertEqual(payload.get("brand"), "Unove")
