# Reference prototypes

These are the two prototype sources the design was signed off on, exported from the design canvas. They are reference material, not code to ship.

| File | What it shows |
| --- | --- |
| `RoutePhases.dc.html` | The phase-chat screen, clickable: rail, past and current phase sections, step checkpoints, lead line, one-tap replies, the "Checking your screen" state, the ready pill, a plan change ("I'm stuck" adds a step), and the completion section. All three palettes are in its `PH_THEMES` |
| `QuickAnswer.dc.html` | The no-plan layout for a quick question |

## How to read them

- They use the canvas's component format: plain HTML with inline styles, `{{holes}}` filled from `renderVals()`, `<sc-for>` for loops and `<sc-if>` for branches. The logic class at the bottom of each file is ordinary JavaScript.
- They will not open on their own in a browser. They depend on the design canvas's runtime (`support.js`), which is not included. Read them as source: the inline styles hold the exact sizes, and the script holds the behaviour.
- In the prototype, a step completes by itself about 10 seconds after the first tap. That stands in for the coach noticing. In the app, completion comes from the coach's turns.
- The demo data (the VPN walkthrough, `vpn.northwind.example`, the certificate step) is made up for illustration.
- Where these files and `SPEC.md` disagree, `SPEC.md` wins. The spec tightens a few things the prototype simplified: step counts within a phase, the stance-specific replies, the needs-you and paused states, and resume.
