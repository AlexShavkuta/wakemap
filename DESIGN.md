# Wakemap design

Read this before touching `viewer/`. Rules here are decisions, each with a reason.

## Brief

- **Who:** a senior engineer or tech lead reviewing work an AI agent did. Expert, short on time, skeptical of the agent.
- **Job:** decide whether the change is safe to merge and where to look. Several times a day, usually right after an agent session or on a PR.
- **Context:** desktop, a wide screen, next to the editor. Phones only for a quick look.
- **In 5 seconds they must know:** the verdict (low risk / needs a review / needs an expert), which file to open first, and how the change flows through the code.
- **Primary action:** open the riskiest file ("Look here first").

## Principles

1. **Map first, prose second.** The canvas is the hero. Panels stay narrow and explain what the map shows.
2. **Quote, don't paraphrase.** The "why" is the agent's own words and the user's own prompt, with timestamps. Nothing on screen is generated text pretending to be fact.
3. **Quiet until it matters.** Neutral paper and ink everywhere; colour only for change status and risk, so changes and problems are what you see.

## Layout

Three columns on desktop: story rail (280px) · canvas · inspector (400px). Below 760px it stacks: canvas (45vh), inspector, story.

- **Story rail:** the prompts in order. Numbering is real here because order matters. Each step shows the files it touched and its flag count.
- **Canvas:** folders as grey areas; files inside. Imports flow top to bottom (an importer sits above what it imports), because the canvas is taller than it is wide.
- **Inspector:** the overview (verdict, "Look here first", the key to the map), a story step, or one file.

## Encoding

| Meaning | Encoding |
| --- | --- |
| Added file | green border, doubled |
| Modified file | amber border |
| Removed file | red dashed border, faint red fill |
| Unchanged file that depends on the change | no fill, quiet text, solid border |
| New import | green line |
| Removed import | red dashed line |
| Steps that changed a file | `1 · 4` in mono at the top right of the node; the current step is accent blue |
| Risk | dot (red high, amber warn, grey info) plus the message |

- Dashed always means gone. Nothing else is dashed.
- Amber already means "modified", so warning text stays ink and only the dot is amber. High-risk text is red.
- Status is never colour alone: every file and symbol also has a `+` / `~` / `−` mark.
- Nothing animates on its own. Edges used to march; that was noise and was removed.

## Tokens

All colours are CSS variables in `viewer/src/styles.css`, with a light and a dark set. Components never use raw colours.

- **Surfaces:** `--background` (paper), `--surface`, `--surface-sunken`, `--area`
- **Text:** `--foreground`, `--text-secondary`, `--text-tertiary`
- **Lines:** `--border`, `--border-strong`
- **Accent:** `--accent`, `--accent-soft`. Used only for the current step and the selected file.
- **Status:** `--added`, `--modified`, `--removed` and their `-soft` fills
- **Risk:** `--risk-high`, `--risk-warn`, `--risk-info`

**Type:** IBM Plex Sans for prose, IBM Plex Mono for anything that is code (paths, symbols, steps, diffs). Plex fits an engineering tool and the mono has clear `0`/`O` and `1`/`l`.

| Token | Size |
| --- | --- |
| `--text-xs` | 11px |
| `--text-sm` | 12px |
| `--text-md` | 13px |
| `--text-lg` | 15px |
| `--text-xl` | 18px |

Weights are 400 and 500 only.

**Radius:** 4 / 6 / 8px. **Spacing:** 4 / 8 / 12 / 16 / 24px. **Motion:** 120ms (hover, colour) and 200ms (opacity, camera moves), ease out, none with reduced motion. **Shadow:** only on floating controls (the zoom buttons).

## Rules

**Never**
- Gradients, glow, glass, decorative blur
- Bold or all caps; eyebrow labels
- Cards inside cards; shadows on things that do not float
- Animation that does not explain a change
- LLM-written text shown as if it came from the code or the transcript

**Always**
- Sentence case
- Semantic tokens only
- Check light, dark, 1440px, 375px and a short phone (375×560), and do a keyboard pass, before calling a UI change done
- Every flag points at a file; every quote shows who said it and when

## Decision log

- **2026-11-24** First version. Three columns, React Flow + ELK, IBM Plex.
- **2026-11-24** Left-to-right flow replaced by top-to-bottom: an 8-layer import chain was 2,400px wide in a tall canvas.
- **2026-11-24** Context neighbours limited to dependants and new imports. Showing every import pulled in `types.ts` and `utils.ts` and turned the map into a hairball.
- **2026-11-24** Design pass:
  - Added the "Look here first" queue, ranked by risk, as the primary action.
  - Added step markers on file nodes.
  - Step labels show the files changed, since prompts like "lets do A" say nothing on their own.
  - Removed marching edges and the dot grid.
  - Made dashed mean only "removed".
  - Warning text is ink, not amber.
  - The header shows the PR title, not the merge-commit subject.
