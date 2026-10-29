-- 0060: a notification type for new website leads.
--
-- When an enquiry or quiz result lands on the pipeline (/api/webhooks/lead),
-- Kyle gets a bell notification, a desktop pop-up while the portal is open,
-- and a push to any device he has switched push on for. He already gets the
-- website's own email, so the bell entry is `in_portal` and the email job
-- sends nothing more.
--
-- Same list as 0054 plus 'lead'. Safe to run more than once.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'message', 'report_ready', 'asset_feedback', 'asset_uploaded',
    'status_change', 'invoice', 'crm_reminder', 'work_brief',
    'approval', 'onboarding', 'nps', 'assistant', 'lead'
  ));

notify pgrst, 'reload schema';
