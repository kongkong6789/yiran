"""
本体图谱 -> PostgreSQL 镜像同步。

图谱对象/关系发生任何增删改,把整张图全量镜像到 PG 的
lake.ont_object / lake.ont_relation,保证数据底座里的对象与本体图谱一致。
批量导入时可 pause_sync(),结束后 resume_sync_and_flush() 只同步一次。
"""
from contextlib import contextmanager

from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from .models import OntObject, OntRelation

_paused = False


def _sync():
    from apps.datalake.pg import pglake

    if not pglake.available():
        return
    try:
        pglake.ensure_ready()
        pglake.sync_ontology()
    except Exception:
        pass


def pause_sync():
    global _paused
    _paused = True


def resume_sync_and_flush():
    global _paused
    _paused = False
    _sync()


@contextmanager
def bulk_import_mode():
    """批量导入期间暂停逐条同步,结束后统一刷一次镜像。"""
    pause_sync()
    try:
        yield
    finally:
        resume_sync_and_flush()


@contextmanager
def suppress_ontology_sync():
    """暂停 PG 镜像同步且不 flush(因果元数据等轻量写,避免阻塞 HTTP)。"""
    global _paused
    prev = _paused
    _paused = True
    try:
        yield
    finally:
        _paused = prev


@receiver(post_save, sender=OntObject)
@receiver(post_delete, sender=OntObject)
@receiver(post_save, sender=OntRelation)
@receiver(post_delete, sender=OntRelation)
def on_ontology_changed(sender, **kwargs):
    if _paused:
        return
    _sync()
