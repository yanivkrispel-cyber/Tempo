-- The check-in secret is encrypted at rest (#345, H-4 on board #347), with the health data key and the same AES-GCM
-- format as health declarations (docs/31 section 7, ADR-0026): [0x01][nonce 12][ciphertext][tag 16], bound to the
-- studio, the person and the key version. The API writes only the ciphertext. A plain secret written before this
-- migration still works and moves to the ciphertext the first time it is used; checkin_secret is dropped once no
-- row holds one.
ALTER TABLE people.people ADD COLUMN checkin_secret_ciphertext bytea;
ALTER TABLE people.people ADD COLUMN checkin_secret_key_version int;
ALTER TABLE people.people ADD CONSTRAINT people_checkin_secret_key_version
    CHECK ((checkin_secret_ciphertext IS NULL) = (checkin_secret_key_version IS NULL));
