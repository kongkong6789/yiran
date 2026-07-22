from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory

from .models import KnowledgeBase
from .serializers import KnowledgeBaseSerializer


class FakeKnowledgeBaseQuerySet:
    def __init__(self, exists_result=False):
        self.exists_result = exists_result
        self.filters = []
        self.excludes = []

    def filter(self, **kwargs):
        self.filters.append(kwargs)
        return self

    def exclude(self, **kwargs):
        self.excludes.append(kwargs)
        return self

    def exists(self):
        return self.exists_result


class FakeKnowledgeBaseManager:
    def __init__(self, queryset):
        self.queryset = queryset

    def filter(self, **kwargs):
        return self.queryset.filter(**kwargs)


class KnowledgeBaseSerializerDuplicateNameTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.owner = SimpleNamespace(id=1, is_authenticated=True)
        self.other = SimpleNamespace(id=2, is_authenticated=True)

    def serializer_for(self, user, data, instance=None):
        request = self.factory.post("/api/knowledge/bases/", data, format="json")
        request.user = user
        return KnowledgeBaseSerializer(instance=instance, data=data, partial=instance is not None, context={"request": request})

    def validate_with_duplicates(self, serializer, exists_result):
        queryset = FakeKnowledgeBaseQuerySet(exists_result=exists_result)
        with patch("apps.knowledge.serializers.KnowledgeBase.objects", FakeKnowledgeBaseManager(queryset)):
            valid = serializer.is_valid()
        return valid, queryset

    def test_private_duplicate_name_is_scoped_to_owner(self):
        serializer = self.serializer_for(self.owner, {"name": " Product Docs ", "visibility": KnowledgeBase.Visibility.PRIVATE})

        valid, queryset = self.validate_with_duplicates(serializer, exists_result=True)

        self.assertFalse(valid)
        self.assertIn("name", serializer.errors)
        self.assertIn({"owner_user_id": self.owner.id}, queryset.filters)

    def test_team_duplicate_name_is_scoped_to_visibility_only(self):
        serializer = self.serializer_for(self.other, {"name": "Ops Policy", "visibility": KnowledgeBase.Visibility.TEAM})

        valid, queryset = self.validate_with_duplicates(serializer, exists_result=True)

        self.assertFalse(valid)
        self.assertIn("name", serializer.errors)
        self.assertNotIn({"owner_user_id": self.other.id}, queryset.filters)
        self.assertEqual(queryset.filters[0]["visibility"], KnowledgeBase.Visibility.TEAM)

    def test_archived_duplicate_name_is_ignored_by_lookup(self):
        serializer = self.serializer_for(self.other, {"name": "History Docs", "visibility": KnowledgeBase.Visibility.TEAM})

        valid, queryset = self.validate_with_duplicates(serializer, exists_result=False)

        self.assertTrue(valid, serializer.errors)
        self.assertTrue(queryset.filters[0]["archived_at__isnull"])

    def test_update_excludes_current_instance(self):
        instance = KnowledgeBase(id=123, name="A", visibility=KnowledgeBase.Visibility.TEAM, owner_user_id=self.owner.id)
        serializer = self.serializer_for(self.owner, {"name": "B"}, instance=instance)

        valid, queryset = self.validate_with_duplicates(serializer, exists_result=True)

        self.assertFalse(valid)
        self.assertEqual(queryset.excludes, [{"pk": instance.pk}])