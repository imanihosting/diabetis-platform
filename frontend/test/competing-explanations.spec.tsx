import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CompetingExplanation } from '@wellovue/types';
import { CompetingExplanations } from '@/components/CompetingExplanations';

/**
 * What the surfaces are allowed to do with a competing explanation.
 *
 * The engine's tests prove the catalogue is reviewed and that nothing in it
 * asks for data the product cannot hold. The only thing a surface can get
 * wrong is writing one — a competing explanation is a clinical claim, and the
 * frontend is the one place it must never be composed.
 */

const SLEEP: CompetingExplanation = {
  label: 'Sleep the night before',
  why: 'Short or broken sleep raises glucose the following day.',
  supportedBy: 'Sleep timing and duration for each night in the period',
  missing: 'Sleep is not recorded',
  capture: null,
};

const CARBS: CompetingExplanation = {
  label: 'The meals themselves were different',
  why: 'Carbohydrate and portion size move a response more than most things.',
  supportedBy: 'Carbohydrate estimates recorded with each meal',
  missing: 'No carbohydrate estimate is recorded for most of these meals',
  capture: 'Record a carbohydrate estimate with each meal',
};

const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('the surfaces only lay out what the engine sent', () => {
  it('renders every field it was given, and invents none', () => {
    const html = renderToStaticMarkup(<CompetingExplanations explanations={[CARBS]} />);

    expect(html).toContain(CARBS.label);
    expect(html).toContain(CARBS.why);
    expect(html).toContain(CARBS.supportedBy);
    expect(html).toContain(CARBS.missing);
    expect(html).toContain(CARBS.capture!);
  });

  it('says plainly when the product cannot record what is missing', () => {
    // The alternative is asking somebody to log something with nowhere to put
    // it, which sends them looking for a control that does not exist.
    const html = renderToStaticMarkup(<CompetingExplanations explanations={[SLEEP]} />);
    expect(html).toContain('cannot record this yet');
  });

  it('keeps the engine’s order', () => {
    // The catalogue is ordered most to least likely to matter for that
    // comparison. A surface reordering it would be making a judgement the
    // review made already.
    const html = renderToStaticMarkup(
      <CompetingExplanations explanations={[CARBS, SLEEP]} />,
    );
    expect(html.indexOf(CARBS.label)).toBeLessThan(html.indexOf(SLEEP.label));
  });

  it('shows nothing when there is nothing to show', () => {
    expect(renderToStaticMarkup(<CompetingExplanations explanations={[]} />)).toBe('');
  });

  it('writes no explanation of its own', () => {
    // The rule that matters most here, and the one a reviewer cannot see by
    // reading a rendered page: the components carry chrome and layout, and
    // every sentence about somebody's glucose arrives as a prop.
    for (const path of [
      'src/components/CompetingExplanations.tsx',
      'src/app/report/page.tsx',
    ]) {
      const text = source(path);
      for (const phrase of [
        'raises glucose',
        'Carbohydrate',
        'insulin',
        'medication was taken',
        'sensor reads',
      ]) {
        expect(text.toLowerCase(), `${path} composes an explanation`).not.toContain(
          phrase.toLowerCase(),
        );
      }
    }
  });

  it('both surfaces read the same field off the finding', () => {
    expect(source('src/components/FindingCard.tsx')).toContain(
      'finding.competingExplanations',
    );
    expect(source('src/app/report/page.tsx')).toContain('finding.competingExplanations');
  });
});

describe('the public site no longer says this is unbuilt', () => {
  it('carries no "Being built" label on any loop step', () => {
    // The label comes off when the thing exists, and only then. Step four was
    // the last one wearing it.
    const steps = source('src/components/marketing/LoopSteps.tsx');
    expect(steps).not.toMatch(/building: true/);
  });

  it('keeps the mechanism for saying "not yet"', () => {
    // Deleting it is how a product ends up with no way to mark the next
    // unbuilt thing at the moment it most needs one.
    const steps = source('src/components/marketing/LoopSteps.tsx');
    expect(steps).toContain('building?: boolean');
    expect(steps).toContain('Being built');
  });
});
