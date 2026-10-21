-- #374 (board #404, K3): the check-in secret lives only as ciphertext under the health data key since migration
-- 0031 (#373). On dev every row a person can still reach moved to the ciphertext through the API's own code path
-- before this ran; the plain column (and its length CHECK from 0029) goes. A person without a secret gets a new
-- one the next time they open their code.
ALTER TABLE people.people DROP COLUMN checkin_secret;
