-- Grants DELETE on the 4 tables a conversation deletion needs to
-- touch (feedback, citations, conversation_messages, conversations —
-- deleted in that order by lib/conversation/persist.ts:deleteConversation,
-- children before parents; no ON DELETE CASCADE exists between them,
-- see db/migrations/0006). app_role never had DELETE on any of these
-- because nothing needed to delete a conversation before this feature.
--
-- This does NOT touch RLS at all: conversations_isolation/
-- conversation_messages_isolation/citations_isolation/
-- feedback_isolation (0009_rls_and_grants.sql) are all already
-- `FOR ALL`, which already covers DELETE — the policies were never
-- the blocker, the coarser table-level GRANT was. A DELETE from
-- app_role is still scoped by the exact same company_id policy as
-- every other command on these tables, unchanged.
GRANT DELETE ON conversations TO app_role;
GRANT DELETE ON conversation_messages TO app_role;
GRANT DELETE ON citations TO app_role;
GRANT DELETE ON feedback TO app_role;
