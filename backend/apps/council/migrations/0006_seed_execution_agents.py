from django.db import migrations


INITIAL_AGENTS = (
    {
        "name": "运营智能体",
        "emoji": "📊",
        "group": "业务执行",
        "role": "运营执行专家",
        "expertise": "擅长经营日报、店铺运营和流程协同",
        "persona": "关注经营结果、数据口径和任务闭环。",
        "execution_role": "operator",
        "quota_limit": 10000,
    },
    {
        "name": "财务智能体",
        "emoji": "💰",
        "group": "业务执行",
        "role": "财务分析专家",
        "expertise": "擅长财务核算、费用分析和经营对账",
        "persona": "关注财务准确性、风险和审批边界。",
        "execution_role": "manager",
        "quota_limit": 100000,
    },
    {
        "name": "市场智能体",
        "emoji": "🎯",
        "group": "业务执行",
        "role": "市场策略专家",
        "expertise": "擅长市场洞察、活动规划和内容分析",
        "persona": "关注用户洞察、增长机会和活动效果。",
        "execution_role": "operator",
        "quota_limit": 10000,
    },
    {
        "name": "数据分析智能体",
        "emoji": "📈",
        "group": "业务执行",
        "role": "数据分析专家",
        "expertise": "擅长多源数据处理、指标诊断和可视化",
        "persona": "关注数据质量、指标口径和可解释结论。",
        "execution_role": "manager",
        "quota_limit": 100000,
    },
    {
        "name": "通用智能体",
        "emoji": "🤖",
        "group": "通用",
        "role": "通用协作助手",
        "expertise": "适合跨部门查询、整理和常规协作任务",
        "persona": "以清晰、稳健和可执行的方式完成通用任务。",
        "execution_role": "operator",
        "quota_limit": 10000,
    },
)


def seed_execution_agents(apps, schema_editor):
    AgentProfile = apps.get_model("council", "AgentProfile")
    if AgentProfile.objects.exists():
        return
    AgentProfile.objects.bulk_create([
        AgentProfile(is_active=True, quota_used=0, **item)
        for item in INITIAL_AGENTS
    ])


class Migration(migrations.Migration):
    dependencies = [
        ("council", "0005_agentprofile_execution_role_agentprofile_is_active_and_more"),
    ]

    operations = [
        migrations.RunPython(seed_execution_agents, migrations.RunPython.noop),
    ]
