-- Baseline placeholder migration.
--
-- This phase (Phase 0 AWS foundation) establishes the migration mechanism
-- itself - not the domain schema (docs/01_AWS_Infrastructure_LLD.md section
-- 11: "the goal in this phase is the migration mechanism, not the full
-- domain schema"). This script only proves DbUp's journal table records a
-- real applied script. The first real schema migration (identity,
-- organizations, ...) lands with the Identity/Membership LLD.
select 1;
