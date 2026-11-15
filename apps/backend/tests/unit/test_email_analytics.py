"""Unit tests for the outreach analytics pure stats function."""

from app.services.email_analytics import compute_email_stats


def _email(**overrides):
    base = {
        "log_id": "log-1",
        "company_id": "co-1",
        "contact_id": None,
        "company_name": "Acme",
        "recipient_email": "hr@acme.example",
        "subject": "Internship inquiry",
        "body": "Hello",
        "purpose": "internship",
        "email_mode": "personalized",
        "outcome": "pending",
        "outcome_note": None,
        "outcome_at": None,
        "sent_at": "2026-10-01T10:00:00+00:00",
    }
    base.update(overrides)
    return base


class TestComputeEmailStats:
    def test_empty_history(self):
        stats = compute_email_stats([])
        assert stats["total_sent"] == 0
        assert stats["response_rate"] == 0.0
        assert stats["timeline"] == []
        assert stats["avg_body_length_responded"] is None

    def test_response_rate_excludes_bounces(self):
        stats = compute_email_stats(
            [
                _email(log_id="a", outcome="responded"),
                _email(log_id="b", outcome="pending"),
                _email(log_id="c", outcome="bounced"),
            ]
        )
        assert stats["total_sent"] == 3
        assert stats["responded"] == 1
        assert stats["bounced"] == 1
        # denominator = total - bounced = 2
        assert stats["response_rate"] == 0.5

    def test_zero_denominator_is_zero_rate(self):
        stats = compute_email_stats([_email(outcome="bounced")])
        assert stats["response_rate"] == 0.0

    def test_unknown_outcome_counts_as_pending(self):
        stats = compute_email_stats([_email(outcome="weird")])
        assert stats["pending"] == 1
        assert stats["total_sent"] == 1

    def test_recipient_type_segments(self):
        stats = compute_email_stats(
            [
                _email(log_id="a", contact_id=None),
                _email(log_id="b", contact_id="contact-1"),
                _email(log_id="c", contact_id="contact-1", outcome="responded"),
            ]
        )
        by_type = {seg["key"]: seg for seg in stats["by_recipient_type"]}
        assert by_type["company"]["sent"] == 1
        assert by_type["contact"]["sent"] == 2
        assert by_type["contact"]["responded"] == 1
        assert by_type["contact"]["response_rate"] == 0.5

    def test_mode_and_purpose_segments_default_buckets(self):
        stats = compute_email_stats(
            [
                _email(log_id="a", email_mode=None, purpose=None),
                _email(log_id="b", email_mode="shared", purpose="referral"),
            ]
        )
        by_mode = {seg["key"]: seg for seg in stats["by_mode"]}
        assert by_mode["personalized"]["sent"] == 1  # None → personalized
        assert by_mode["shared"]["sent"] == 1
        by_purpose = {seg["key"]: seg for seg in stats["by_purpose"]}
        assert by_purpose["general"]["sent"] == 1  # None → general
        assert by_purpose["referral"]["sent"] == 1

    def test_avg_body_length_split_by_outcome(self):
        stats = compute_email_stats(
            [
                _email(log_id="a", outcome="responded", body="x" * 100),
                _email(log_id="b", outcome="pending", body="y" * 50),
                _email(log_id="c", outcome="not_interested", body="z" * 10),
            ]
        )
        assert stats["avg_body_length_responded"] == 100.0
        # non-responded = pending + not_interested
        assert stats["avg_body_length_not_responded"] == 30.0

    def test_top_subjects_only_replied_and_sorted(self):
        stats = compute_email_stats(
            [
                _email(log_id="a", subject="Alpha", outcome="responded"),
                _email(log_id="b", subject="Alpha", outcome="pending"),
                _email(log_id="c", subject="Beta", outcome="responded"),
                _email(log_id="d", subject="Gamma", outcome="pending"),
            ]
        )
        subjects = [item["subject"] for item in stats["top_subjects"]]
        # "Gamma" never got a reply → excluded; Alpha (2 sent, 1 reply) first.
        assert subjects == ["Alpha", "Beta"]
        alpha = stats["top_subjects"][0]
        assert alpha["sent"] == 2
        assert alpha["response_rate"] == 0.5

    def test_timeline_groups_by_send_day(self):
        stats = compute_email_stats(
            [
                _email(log_id="a", sent_at="2026-10-01T09:00:00+00:00"),
                _email(
                    log_id="b",
                    sent_at="2026-10-01T15:00:00+00:00",
                    outcome="responded",
                ),
                _email(log_id="c", sent_at="2026-10-02T11:00:00+00:00"),
            ]
        )
        assert stats["timeline"] == [
            {"date": "2026-10-01", "sent": 2, "responded": 1},
            {"date": "2026-10-02", "sent": 1, "responded": 0},
        ]
