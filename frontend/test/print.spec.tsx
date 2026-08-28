import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packetDocumentTitle } from '@wellovue/types';

/**
 * The packet as a printed object.
 *
 * PRODUCT.md calls the summary a thing somebody carries into an appointment,
 * and until this it was a web page that happened not to fall over when
 * printed: the app's navigation came out on the paper, findings broke across
 * pages wherever they landed, and page four carried nothing to say whose
 * record it was.
 *
 * Print output is awkward to assert from a test runner — there is no DOM here
 * and no printer. What can be pinned is the contract the stylesheet depends
 * on: which elements are marked to be hidden, kept whole, or shown only on
 * paper, and that the rules acting on those marks still exist. The layout
 * itself was verified by printing to PDF and reading it back page by page.
 */

const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const CSS = source('src/app/globals.css');
const SHELL = source('src/components/AppShell.tsx');
const REPORT = source('src/app/report/page.tsx');

describe('the printed page identifies itself', () => {
  it('puts the name and the period in the document title', () => {
    // The browser prints the title in its own header on every page. It is the
    // one piece of per-page identification that works in every browser.
    const title = packetDocumentTitle(
      {
        patient: { displayName: 'Ada Lovelace' },
        period: { from: new Date('2026-06-01'), to: new Date('2026-08-30'), days: 90 },
      },
      (d) => d.toISOString().slice(0, 10),
    );

    expect(title).toContain('Ada Lovelace');
    expect(title).toContain('2026-06-01');
    expect(title).toContain('2026-08-30');
  });

  it('still says something when no name was recorded', () => {
    const title = packetDocumentTitle(
      {
        patient: { displayName: null },
        period: { from: new Date('2026-06-01'), to: new Date('2026-08-30'), days: 90 },
      },
      (d) => d.toISOString().slice(0, 10),
    );
    expect(title).toContain('Wellovue user');
  });

  it('sets it from the packet, and puts the tab title back afterwards', () => {
    // A patient's name left in the tab title after navigating away is that
    // name in the history of a shared computer.
    expect(REPORT).toContain('packetDocumentTitle');
    expect(REPORT).toContain('document.title = previous');
  });

  it('repeats the identification on every sheet without the browser', () => {
    expect(REPORT).toContain('data-print="running"');
    expect(CSS).toContain('[data-print="running"]');
    expect(CSS).toMatch(/\[data-print="running"\][^}]*position: fixed/s);
  });

  it('names who it is about and admits what it cannot verify', () => {
    // The packet holds a name and no other identifier. A clinician filing it
    // beside a hospital record needs to know it was never matched to one.
    expect(REPORT).toContain('packet.patient.displayName');
    expect(REPORT).toContain('Name not recorded');
    expect(REPORT).toContain('rather than a verified patient record');
  });
});

describe('the application does not print', () => {
  it('marks the app header and footer as chrome', () => {
    const marks = SHELL.match(/data-print="hide"/g) ?? [];
    expect(marks.length).toBeGreaterThanOrEqual(2);
  });

  it('has a rule that actually hides them', () => {
    expect(CSS).toMatch(/@media print/);
    expect(CSS).toMatch(/\[data-print="hide"\][^}]*display: none/s);
  });

  it('drops the period switcher, which is a control and not content', () => {
    expect(REPORT).toContain('print:hidden');
  });
});

describe('page breaks fall between objects, not through them', () => {
  it('marks the things that read as nonsense when halved', () => {
    // An experiment, a lab series, a finding's heading with its number, a
    // table of post-meal measurements.
    const marks = REPORT.match(/data-print="keep"/g) ?? [];
    expect(marks.length).toBeGreaterThanOrEqual(6);
  });

  it('has rules for keeping them whole and for headings', () => {
    expect(CSS).toMatch(/\[data-print="keep"\][^}]*break-inside: avoid/s);
    expect(CSS).toMatch(/break-after: avoid/);
    expect(CSS).toMatch(/orphans: 3/);
  });

  it('does not try to keep a whole section on one page', () => {
    // A findings section runs to several pages. Forcing it whole pushes it to
    // a fresh sheet and leaves the previous one half empty, which over a
    // ninety-day packet costs whole sheets. Measured: it did, twice.
    expect(REPORT).toContain('<section className="mt-10">');
  });
});

describe('nothing is lost to a collapsed disclosure', () => {
  it('opens them before the print and closes them after', () => {
    // CSS cannot do this: Chrome hides a closed `details` body through its own
    // shadow slot. The obvious stylesheet attempt removes the label as well
    // and reveals nothing — verified by printing and reading the PDF back.
    const explanations = source('src/components/CompetingExplanations.tsx');
    expect(explanations).toContain("addEventListener('beforeprint'");
    expect(explanations).toContain("addEventListener('afterprint'");
  });

  it('no longer hides the summary on paper', () => {
    expect(CSS).not.toMatch(/details\s*>\s*summary\s*\{\s*display: none/);
  });
});
