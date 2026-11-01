# Scoring Glossary

Terms used by the table-tennis score tracking stack.

- **Game** — a single game to 11 points (veribase), won by leading by two.
- **Match** — an odd number of games; a player wins by taking the majority.
- **Serve rotation** — two serves per side, alternating every second point (veribase).
- **Point event** — the atomic score change the scorekeeper emits.
- **Undo** — retracting the latest point event; enforced as a single-step operation.

The scorekeeping packages must treat these rules as shared logic; apps differ only in presentation.
