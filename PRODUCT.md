# Product Context

## Register

**brand** for `/` and any marketing surface. **product** for `/timeline`, `/log`,
`/evidence`, `/login`.

The landing page is the brand surface: design is the product there. Everything
behind sign-in serves the data.

## Users & Purpose

**Primary: a person living with Type 2 diabetes.** Usually diagnosed years ago,
already has numbers coming at them from a meter, a CGM, or a lab printout, and
has been told what to do without being told what is true for them specifically.
They are not looking for another number. They are looking for a reason.

The context is a kitchen table on a weekday evening, laptop open, after dinner,
working out whether the walk actually helped. Careful reading, not glancing.

**Secondary: their clinician.** Never the primary voice on the page, but present
enough that the patient can see this produces something a professional will take
seriously. A ten-minute appointment cannot absorb hundreds of charts.

The job: *turn everyday diabetes data into personal, testable metabolic evidence.*

## Product Purpose

Most diabetes tools record what happened. This one is built to answer what is
likely true for one person's body, what remains uncertain, and what safe next
observation would reduce that uncertainty.

The loop: collect trusted data, build one timeline, detect patterns, generate
competing explanations, propose a safe experiment, measure the result against
the original prediction, and turn the outcome into something the person and
their clinician can both use.

## Brand Personality

- **Exact.** Numbers are the content. Say 1.1 mmol/L, not "lower".
- **Candid about uncertainty.** Every claim carries how strong the evidence is
  and what it does not account for. Showing the limits is the trust signal, not
  a disclaimer to bury.
- **Unhurried.** No urgency, no streaks, no nudging. The reader has had this
  condition for years and will have it tomorrow.
- **Non-judgmental about food and behaviour.** Tradeoffs, never guilt.
- **Quiet.** The interface does not celebrate itself.

## Anti-References

Explicitly confirmed by the product owner. Any of these appearing is a failure.

1. **Clinical white-and-teal healthcare.** Sterile hospital palette, stock
   photography, heartbeat or blood-droplet iconography, rounded feature cards in
   a three-grid.
2. **Consumer wellness app.** Purple-pink gradients, streaks, badges,
   encouragement, exclamation marks, cartoon illustration.
3. **Generic B2B SaaS.** Floating dashboard screenshot on a gradient, "trusted
   by" logo strip, icon-heading-text repeated three times, navy CTA band.
4. **Generic AI health coach.** Chat bubbles, vague encouragement, food guilt,
   glucose-tracker framing, or anything that sounds like medical advice without
   evidence behind it.

## Strategic Design Principles

**Colour is reserved for meaning.** The product already assigns meaning to
colour: evidence strength, and glucose relative to target range. On the landing
page those are the only chromatic moments. Everything else is ink on paper.
A reader should be able to tell that a colour means something before reading the
label.

**Show the real thing.** The page renders the actual product components against
real seeded data, not a mockup of them. A health product that fakes its own
screenshots has already told you something.

**Show a finding with its limitations attached.** The single most differentiating
thing this product does is admit what it does not know. That belongs on the
landing page in full, not softened.

**State the safety boundary plainly.** What the platform will never do is a
reason to trust it, not fine print.

## Accessibility

WCAG 2.1 AA minimum. Colour never carries meaning alone: every coloured state is
paired with a label or shape. Motion respects `prefers-reduced-motion`. Target
range bands and evidence strength must remain distinguishable in greyscale,
because these get printed and handed to a clinician.
