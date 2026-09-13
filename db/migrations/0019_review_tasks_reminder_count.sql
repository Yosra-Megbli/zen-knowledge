-- W3: add reminder_count to review_tasks to track number of reminders sent
ALTER TABLE review_tasks ADD COLUMN IF NOT EXISTS reminder_count int NOT NULL DEFAULT 0;
