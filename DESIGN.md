# Design System — Wellovue

The taste used to live in code comments. This is where it lives now.

Read [PRODUCT.md](./PRODUCT.md) first: it holds the audience, the voice, and
the anti-references. This document holds the mechanics that serve them.

**The stance, in one line:** Apple product pacing, medical-grade evidence,
Braun instrument clarity. Not glossy, not clinical, not a form.

---

## 1. The one thing that is not negotiable

Colour means exactly two things:

1. where a glucose value sits relative to target,
2. how far a finding can be trusted.

Nothing else is coloured. Not navigation, not buttons, not status chips for
"running", not decoration. A reader should be able to tell that a colour means
something before reading the label, and that only works if the colour is scarce.

Two consequences that look like limits and are the identity:

- **The chromatic moment is the product object.** The glucose trace against its
  target band is the only place colour appears at size. That makes it the hero
  by construction rather than by decoration.
- **Everything survives greyscale.** These pages get printed and handed to a
  clinician. Every coloured state is paired with a word or a shape, and no
  surface depends on colour to be legible.

---

## 2. Surfaces

The old failure was a bordered rectangle around everything, which reads as a
form system. Three levels, and most content is on level 0.

| Level | Use | Screen | Print |
|---|---|---|---|
| **0 — paper** | Default. Prose, lists, most sections. | Nothing. No border, no fill. | Nothing. |
| **1 — raised** | An object worth lifting off the page: the trace, a finding, the clinician packet, a form. | `bg-paper-raised` + `shadow-raised`. No border. | Hairline border restored. |
| **2 — sunk** | Insets that recede: quiet notes, empty states. | `bg-paper-sunk`. No border. | Hairline border restored. |

**Separation is a rule, not a rectangle.** To divide sections, use a single
`border-t border-rule` and space. A four-sided border is reserved for something
that is genuinely an object.

Shadows are warm and barely there. Two layers: a 1px contact shadow so the edge
is defined, and a wide soft one so the object sits on the paper rather than
floating above it.

```css
--shadow-raised:
  0 1px 2px -1px oklch(0.235 0.014 75 / 0.07),
  0 10px 30px -18px oklch(0.235 0.014 75 / 0.22);
```

In dark mode the contact shadow does nothing, so level 1 gains a hairline of
light instead. Declared once in `globals.css`.

**Banned outright.** A coloured `border-left`/`border-right` above 1px as an
accent on a card, list item or callout. If something needs marking, use a
leading number, a heading, or space.

---

## 3. Space

Space is the premium signal. Where the old layout used a border to say "this is
a group", the new one uses distance.

| Token | Value | Use |
|---|---|---|
| Section rhythm | `clamp(3.5rem, 8vw, 7rem)` | Between marketing folds |
| Object padding | `clamp(1.5rem, 3vw, 2.5rem)` | Inside a level-1 surface |
| App section gap | `2.5rem` / `4rem` | Between app sections |
| Group gap | `1rem` / `1.5rem` | Between related items |

Vary it. Identical padding everywhere is monotony; a tight group inside a
generous section is rhythm.

---

## 4. Width

| Surface | Container | Text inside |
|---|---|---|
| Marketing | `max-w-6xl` (72rem) | `max-w-[62ch]` for lede, `max-w-[68ch]` for prose |
| App | `max-w-6xl` (72rem) | `max-w-prose` (65ch) for prose, full width for charts and tables |

The app used to be `max-w-3xl`, which made a product feel like a document. Both
surfaces now share an outer width, so moving between them is not a change of
scale. Readable text stays narrow *inside* that width; charts, the timeline and
the clinician packet use it all.

---

## 5. Type

Atkinson Hyperlegible, and this is a functional choice rather than a stylistic
one: the Braille Institute drew it for low vision, and retinopathy is a
complication of the condition this serves. The mono cut is reserved for measured
values, which is what `.measure` marks.

| Step | Size | Use |
|---|---|---|
| `statement` | `clamp(2.35rem, 1.5rem + 3.5vw, 4.5rem)` | Landing hero, page headings |
| `fold` | `clamp(1.8rem, 1.2rem + 2.4vw, 3.25rem)` | Section headings, marketing |
| `lede` | `clamp(1.05rem, 0.98rem + 0.42vw, 1.375rem)` | Marketing body |
| `reading` | `2.25rem` | A measurement the reader came for |
| `reading-sm` | `1.5rem` | A secondary measurement |
| `sm` / `xs` | fixed | App UI, labels, metadata |

Marketing is fluid; app UI is fixed. A dashboard viewed at a consistent DPI does
not want a heading that shrinks in a narrow column.

Never below `text-xs`, and `text-xs` is raised on small screens (`globals.css`)
because the smallest tier is marginal on a phone held at arm's length, which is
exactly how a reader with retinopathy meets it.

---

## 6. Controls

Every control has default, hover, focus, active and disabled. One vocabulary
across both surfaces.

| Style | Looks like | Use |
|---|---|---|
| **Primary** | Ink fill, paper text, 3rem tall, generous horizontal padding, lifts 1px on hover | The one action that matters on a screen. Never two per view. |
| **Secondary** | Level-1 surface, ink text, same height and padding | Real alternatives. Not an underlined link. |
| **Quiet** | Ink text with the nav band on hover | Navigation and tertiary actions. |

Minimum target 44×44. Transitions 150–200ms, ease-out; never a bounce. The
global focus ring is a 2px ink outline offset 3px, so it lands on paper even on
the ink-filled button.

Disabled is reduced opacity and `cursor-not-allowed`, never a colour change —
colour means something else here.

---

## 7. The navigation band

The current-page marker is the target band's own geometry: a defined upper
bound with a wash beneath it, in ink. It is the identity mark of the product
reduced to four pixels, and it is deliberately *not* drawn in the range colour,
because a green underline under "About" would mean neither of the two things
colour is allowed to mean. It survives greyscale.

The same band, at full width and lower opacity, separates the footer.

---

## 8. Motion

- Reveal on scroll: 900ms, `cubic-bezier(0.16, 1, 0.3, 1)`, translateY 1.25rem.
- The trace draws once, left to right, like a plotter: 2400ms.
- Controls: 150–200ms.
- Everything is fully visible under `prefers-reduced-motion: reduce`. Motion
  conveys state or arrival, never decoration.

---

## 9. Charts

One chart language. The target band is drawn as a wash with a dashed upper
bound, never a solid saturated line — a hairline running the full width of a
1280px page shouts, and this product does not.

Axis labels are `.measure`, `text-xs`, `--ink-faint`. Series are ink unless the
value carries zone meaning, in which case the zone colour applies and a label
accompanies it.

**Every finding that compares glucose is drawn against the band.** A difference
of 1.1 mmol/L between two groups says nothing about whether either group ended
up in range; two curves against the target band say it immediately, and that is
the difference between a statistic and something about a person's body. The
numbers come from the detector — measured baselines and peaks, never
interpolated — and a curve's control point sits *at* its peak rather than above
it, so the drawing never shows a value higher than the one measured.

A finding with no comparison draws no chart. Lab trends have no band to sit
against, and an empty axis would imply the data exists and is flat.

**The wash is held below full strength on small frames.** The target range runs
3.9 to 10, so on a short chart the band fills most of the height and stops
reading as a band a reading sits inside. Held at 70% against paper, as the hero
trace is.

---

## 10. Using the width

Product width is not permission to stretch a column of short text across
1088px. Where a surface has two kinds of content, split it and let each stay
readable.

The finding is the worked example. It used to be a tall single column: claim,
then effect, then limitations, then what would sharpen it, then the action —
which wasted the width and pushed the limitations below the fold. It is now the
claim and its number on the left, everything that qualifies them on the right.
That is a product improvement as much as a visual one: the qualifications are
the half that makes this evidence rather than a headline, and they are now
beside the claim rather than beneath it.

Stacks to one column below `lg`. Prose inside either column stays at 52ch.

---

## 11. Naming what the engine found

`findingType` is the record's identifier: a clinician quotes it, the packet
keys on it, and it must not drift. It is not a heading.
`late_evening_meal_response` tells somebody with diabetes nothing about their
evening meal.

Every surface shows the title and lens from `findingPresentation()` in the
shared contract, with the identifier kept as a quiet reference in the clinician
packet where somebody would actually cite it. The map is a display name for an
enum, in the same category as `careModeLabel`. It restates what a detector
already measures and must never be where a new claim is introduced — anything
that interprets a person's data belongs in the engine, behind the review that
gets it there.

The lens exists because the same number means different things in different
physiology. "A 3.1 mmol/L larger rise" is a post-meal glucose response
question, and saying so is what separates this from an analytics dashboard
pointed at glucose.

A p-value is a statistic, not a limitation. Listing it among the things a
finding cannot account for is what made the evidence screen read as a lab
report. It has its own field and lives behind a disclosure.

---

## 12. The icon

`frontend/src/app/icon.svg`, with `apple-icon.png` rendered from it at 180px.
It is `RangeMark` squared: a trace spiking above target and settling back into
the band, which is the same story the header mark tells.

Three things the size forces, none of them optional:

- **It carries its own paper ground.** Not transparent. Warm paper is the
  identity, and a near-black trace on transparency disappears against a dark
  tab strip — the icon has to survive chrome we do not control. Checked against
  both light and dark tab mockups at 16px.
- **Literal hex, not tokens.** A favicon cannot see CSS variables. The values
  were resolved by painting each token to a canvas and reading the pixel back,
  because `getComputedStyle` returns the `oklch()` string and parsing that
  naively produces nonsense — the same trap the contrast checker hit.
- **Fewer points and a deeper band than the charts use.** The five-point curve
  holds at 28×16 in a wordmark and turns to mush at 16px square, and the
  in-range wash is tuned to sit *behind* a measurement, so at 16px it vanishes
  into the paper. Both are adjusted for the size rather than copied, which is
  the difference between using a token and obeying it.

A double hyphen is illegal inside an XML comment, so token names cannot be
written as `--name` in the comments in that file.

---

## 13. What would make this wrong

A quick self-check before shipping a surface:

- Could a reader guess "healthcare" from the palette? Then it has drifted to
  white-and-teal, which is anti-reference 1.
- Is there a coloured thing that means neither glucose-against-target nor
  evidence strength? Then colour has stopped meaning anything.
- Is the screen a stack of same-sized bordered rectangles? Then it is a form,
  not a product.
- Does it still read at 100% greyscale, printed? If not, a clinician cannot use
  it.
- Is the most important object on the screen also the largest? On the landing
  page that is the day's trace, not the headline.
