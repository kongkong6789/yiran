from django.conf import settings
from django.db import models


class KnowledgeTemplate(models.Model):
    """知识库方案模板:定义默认检索、治理、输入输出和适用场景。"""

    class Kind(models.TextChoices):
        COMPILED = "compiled", "整编知识"
        EVIDENCE = "evidence", "证据问答"
        GRAPH = "graph", "关系图谱"
        HYBRID = "hybrid", "混合知识"
        CUSTOM = "custom", "自定义"

    class State(models.TextChoices):
        OFFICIAL = "official", "官方"
        CUSTOM = "custom", "自定义"
        EXPERIMENTAL = "experimental", "实验"
        ARCHIVED = "archived", "归档"

    template_id = models.CharField("模板标识", max_length=64, unique=True)
    name = models.CharField("名称", max_length=128)
    category = models.CharField("分类", max_length=64, blank=True, default="")
    kind = models.CharField("类型", max_length=16, choices=Kind.choices, default=Kind.HYBRID)
    state = models.CharField("状态", max_length=16, choices=State.choices, default=State.OFFICIAL)
    headline = models.CharField("一句话说明", max_length=255, blank=True, default="")
    description = models.TextField("描述", blank=True, default="")
    accepted_file_types = models.JSONField("支持文件类型", default=list, blank=True)
    default_config = models.JSONField("默认配置", default=dict, blank=True)
    output_capabilities = models.JSONField("输出能力", default=list, blank=True)
    limitations = models.JSONField("限制", default=list, blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "知识库模板"
        verbose_name_plural = "知识库模板"
        ordering = ["category", "name"]

    def __str__(self):
        return self.name


class KnowledgeBase(models.Model):
    """知识库主表:前端首页卡片对应这张表。"""

    class Visibility(models.TextChoices):
        PRIVATE = "private", "个人"
        TEAM = "team", "团队"
        COMPANY = "company", "公司"

    class RetrievalMode(models.TextChoices):
        NAIVE = "naive-rag", "证据优先 RAG"
        GRAPH = "graph-rag", "关系图谱 RAG"
        HYBRID = "hybrid-rag", "混合检索"

    class Status(models.TextChoices):
        DRAFT = "draft", "草稿"
        PROCESSING = "processing", "处理中"
        READY = "ready", "可用"
        REVIEW = "review", "待复核"
        ARCHIVED = "archived", "归档"

    template = models.ForeignKey(
        KnowledgeTemplate,
        related_name="knowledge_bases",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        verbose_name="模板",
    )
    name = models.CharField("名称", max_length=160)
    description = models.TextField("描述", blank=True, default="")
    category = models.CharField("分类", max_length=64, blank=True, default="")
    icon = models.CharField("图标", max_length=64, blank=True, default="database")
    tags = models.JSONField("标签", default=list, blank=True)
    visibility = models.CharField("可见范围", max_length=16, choices=Visibility.choices, default=Visibility.TEAM)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="knowledge_bases",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        verbose_name="负责人",
    )
    retrieval_mode = models.CharField("检索模式", max_length=24, choices=RetrievalMode.choices, default=RetrievalMode.HYBRID)
    review_policy = models.CharField("审核策略", max_length=24, blank=True, default="sample")
    status = models.CharField("状态", max_length=16, choices=Status.choices, default=Status.DRAFT)
    config = models.JSONField("配置", default=dict, blank=True)
    file_count = models.PositiveIntegerField("文件数", default=0)
    app_count = models.PositiveIntegerField("关联应用数", default=0)
    recall_count = models.PositiveIntegerField("召回次数", default=0)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)
    archived_at = models.DateTimeField("归档时间", null=True, blank=True)

    class Meta:
        verbose_name = "知识库"
        verbose_name_plural = "知识库"
        indexes = [
            models.Index(fields=["status", "updated_at"]),
            models.Index(fields=["visibility", "updated_at"]),
            models.Index(fields=["category", "updated_at"]),
        ]
        ordering = ["-updated_at"]

    def __str__(self):
        return self.name


class KnowledgeFile(models.Model):
    """知识库文件明细:文档窗口列表对应这张表。"""

    class Status(models.TextChoices):
        UPLOADED = "uploaded", "已上传"
        PROCESSING = "processing", "处理中"
        READY = "ready", "可用"
        REVIEW = "review", "待复核"
        FAILED = "failed", "失败"
        ARCHIVED = "archived", "归档"

    knowledge_base = models.ForeignKey(KnowledgeBase, related_name="files", on_delete=models.CASCADE, verbose_name="知识库")
    original_filename = models.CharField("原始文件名", max_length=255)
    file_type = models.CharField("文件类型", max_length=32, blank=True, default="")
    segment_mode = models.CharField("分段模式", max_length=32, blank=True, default="general")
    char_count = models.PositiveIntegerField("字符数", default=0)
    chunk_count = models.PositiveIntegerField("切片数", default=0)
    recall_count = models.PositiveIntegerField("召回次数", default=0)
    status = models.CharField("状态", max_length=16, choices=Status.choices, default=Status.UPLOADED)
    storage_path = models.CharField("存储路径", max_length=512, blank=True, default="")
    content_hash = models.CharField("内容 Hash", max_length=128, blank=True, default="", db_index=True)
    metadata = models.JSONField("元数据", default=dict, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="knowledge_files",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        verbose_name="上传人",
    )
    uploaded_at = models.DateTimeField("上传时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)
    archived_at = models.DateTimeField("归档时间", null=True, blank=True)

    class Meta:
        verbose_name = "知识库文件"
        verbose_name_plural = "知识库文件"
        indexes = [
            models.Index(fields=["knowledge_base", "status", "uploaded_at"]),
            models.Index(fields=["knowledge_base", "original_filename"]),
        ]
        ordering = ["-uploaded_at"]

    def __str__(self):
        return self.original_filename


class KnowledgeIngestJob(models.Model):
    """文件入库任务:解析、切块、向量化、图谱抽取的状态机。"""

    class Status(models.TextChoices):
        PENDING = "pending", "等待"
        PARSING = "parsing", "解析中"
        CHUNKING = "chunking", "切块中"
        EMBEDDING = "embedding", "向量化"
        GRAPHING = "graphing", "图谱抽取"
        READY = "ready", "完成"
        FAILED = "failed", "失败"

    file = models.ForeignKey(KnowledgeFile, related_name="jobs", on_delete=models.CASCADE, verbose_name="文件")
    status = models.CharField("状态", max_length=16, choices=Status.choices, default=Status.PENDING)
    stage = models.CharField("阶段", max_length=64, blank=True, default="pending")
    progress = models.PositiveSmallIntegerField("进度", default=0)
    error = models.JSONField("错误", null=True, blank=True)
    metrics = models.JSONField("处理指标", default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="knowledge_ingest_jobs",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        verbose_name="发起人",
    )
    started_at = models.DateTimeField("开始时间", null=True, blank=True)
    finished_at = models.DateTimeField("结束时间", null=True, blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "知识入库任务"
        verbose_name_plural = "知识入库任务"
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["file", "created_at"]),
        ]
        ordering = ["-created_at"]


class KnowledgeChunkRef(models.Model):
    """底层切片引用:不复制向量或 AGE 实体,只保存业务层可追踪引用。"""

    file = models.ForeignKey(KnowledgeFile, related_name="chunk_refs", on_delete=models.CASCADE, verbose_name="文件")
    chunk_index = models.PositiveIntegerField("切片序号")
    chunk_ref = models.CharField("切片引用", max_length=255, blank=True, default="")
    text_preview = models.TextField("文本预览", blank=True, default="")
    embedding_ref = models.CharField("向量引用", max_length=255, blank=True, default="")
    graph_entity_ref = models.CharField("图谱实体引用", max_length=255, blank=True, default="")
    metadata = models.JSONField("元数据", default=dict, blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    class Meta:
        verbose_name = "知识切片引用"
        verbose_name_plural = "知识切片引用"
        constraints = [
            models.UniqueConstraint(fields=["file", "chunk_index"], name="uniq_knowledge_file_chunk_index"),
        ]
        ordering = ["file_id", "chunk_index"]


class KnowledgeSourceBinding(models.Model):
    """业务知识库与底层能力源的绑定:GraphRAG/Wiki/Traditional RAG/外部 API。"""

    class SourceType(models.TextChoices):
        GRAPH = "graph", "GraphRAG"
        WIKI = "wiki", "Wiki"
        TRADITIONAL = "traditional", "Traditional RAG"
        EXTERNAL = "external", "外部知识库"

    knowledge_base = models.ForeignKey(KnowledgeBase, related_name="source_bindings", on_delete=models.CASCADE, verbose_name="知识库")
    source_type = models.CharField("来源类型", max_length=24, choices=SourceType.choices)
    source_id = models.CharField("来源 ID", max_length=128, blank=True, default="")
    source_name = models.CharField("来源名称", max_length=160, blank=True, default="")
    workspace = models.CharField("工作空间", max_length=160, blank=True, default="")
    config = models.JSONField("绑定配置", default=dict, blank=True)
    enabled = models.BooleanField("启用", default=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "知识源绑定"
        verbose_name_plural = "知识源绑定"
        indexes = [
            models.Index(fields=["knowledge_base", "source_type", "enabled"]),
            models.Index(fields=["source_type", "source_id"]),
        ]


class KnowledgePermission(models.Model):
    """知识库权限:用于后续团队/用户/组织维度授权。"""

    class SubjectType(models.TextChoices):
        USER = "user", "用户"
        TEAM = "team", "团队"
        ORG = "org", "组织"

    class Role(models.TextChoices):
        OWNER = "owner", "负责人"
        EDITOR = "editor", "编辑者"
        VIEWER = "viewer", "查看者"

    knowledge_base = models.ForeignKey(KnowledgeBase, related_name="permissions", on_delete=models.CASCADE, verbose_name="知识库")
    subject_type = models.CharField("主体类型", max_length=16, choices=SubjectType.choices)
    subject_id = models.CharField("主体 ID", max_length=128)
    role = models.CharField("角色", max_length=16, choices=Role.choices, default=Role.VIEWER)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    class Meta:
        verbose_name = "知识库权限"
        verbose_name_plural = "知识库权限"
        constraints = [
            models.UniqueConstraint(fields=["knowledge_base", "subject_type", "subject_id"], name="uniq_knowledge_permission_subject"),
        ]


class KnowledgeAuditLog(models.Model):
    """知识库操作审计:创建、上传、删除、发布、绑定、审核。"""

    knowledge_base = models.ForeignKey(
        KnowledgeBase,
        related_name="audit_logs",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        verbose_name="知识库",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="knowledge_audit_logs",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        verbose_name="操作人",
    )
    action = models.CharField("动作", max_length=64)
    target_type = models.CharField("目标类型", max_length=64, blank=True, default="")
    target_id = models.CharField("目标 ID", max_length=128, blank=True, default="")
    payload = models.JSONField("载荷", default=dict, blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    class Meta:
        verbose_name = "知识库审计"
        verbose_name_plural = "知识库审计"
        indexes = [
            models.Index(fields=["knowledge_base", "created_at"]),
            models.Index(fields=["actor", "created_at"]),
            models.Index(fields=["action", "created_at"]),
        ]
        ordering = ["-created_at"]
