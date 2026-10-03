# Project constitution

Principles every agent follows in this project. Edit them; `keel compile` puts them in every agent's instructions.

- Product intent (brief, PRD, criteria) is separate from technical design (ADRs). Don't mix them.
- Prefer the simplest design that satisfies the criteria. No speculative features.
- Every user-visible string is localizable. Every screen handles empty, loading, error and offline states.
- Accessibility: WCAG 2.2 AA contrast, labels on every control, dynamic type respected.
- No secrets in the repo. Credentials come from the platform keychain or CI secrets.
