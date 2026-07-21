class KnowledgeDatabaseRouter:
    """Route the knowledge app to the `knowledge` DB alias (often a dedicated PostgreSQL)."""

    knowledge_app_label = "knowledge"
    knowledge_db = "knowledge"

    def db_for_read(self, model, **hints):
        if model._meta.app_label == self.knowledge_app_label:
            return self.knowledge_db
        return None

    def db_for_write(self, model, **hints):
        if model._meta.app_label == self.knowledge_app_label:
            return self.knowledge_db
        return None

    def allow_relation(self, obj1, obj2, **hints):
        labels = {obj1._meta.app_label, obj2._meta.app_label}
        if self.knowledge_app_label in labels:
            return len(labels) == 1
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if app_label == self.knowledge_app_label:
            return db == self.knowledge_db
        if db == self.knowledge_db:
            return False
        return None
