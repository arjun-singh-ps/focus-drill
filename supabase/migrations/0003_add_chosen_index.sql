-- Focus Drill — capture which choice she actually picked.
--
-- HOW TO APPLY: paste into the Supabase SQL Editor and run once, after 0001 and 0002.
--
-- session_log has always stored was_correct, but never which of the four choices
-- was selected. That was enough for the adaptive engine and the accuracy charts,
-- but a revision view ("you picked B, the answer is C, here's why") needs the
-- actual pick, not just right/wrong. Null covers a timeout, where nothing was
-- ever selected.

alter table session_log
  add column if not exists chosen_index integer
  check (chosen_index is null or (chosen_index >= 0 and chosen_index <= 3));
