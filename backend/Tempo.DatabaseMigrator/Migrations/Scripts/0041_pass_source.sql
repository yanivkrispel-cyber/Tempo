-- Where a pass came from (docs/40, board #584 K3): `import` for a balance moved over from a studio's old system by
-- importPasses, `desk` for every other one (granted at the desk, or the intro pass of a public join, which keeps its
-- own to_pay_at_studio mark). The pass card and the member's passes show "imported" from it, and a second run of the
-- same file finds the passes it made. 0040 is #561's.
ALTER TABLE scheduling.passes
    ADD COLUMN source text NOT NULL DEFAULT 'desk' CHECK (source IN ('desk', 'import'));
