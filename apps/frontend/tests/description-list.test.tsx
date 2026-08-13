import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DescriptionList } from '@/components/resume/description-list';
import baseStyles from '@/components/resume/styles/_base.module.css';

describe('DescriptionList', () => {
  it('renders bullet rows with a marker and plain rows without marker indentation', () => {
    render(
      <DescriptionList
        items={['Core module', 'Built reliable workflows']}
        styles={['plain', 'bullet']}
      />
    );

    const rows = screen.getAllByRole('listitem');

    expect(rows[0]).not.toHaveClass('ml-4');
    expect(within(rows[0]).queryByText('•')).not.toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('Core module');

    expect(rows[1]).toHaveClass('ml-4');
    // The marker glyph comes from CSS (--bullet-marker), so only the span class
    // is asserted here — the actual glyph is rendered via ::before content.
    const markerSpan = rows[1].querySelector(`.${baseStyles['resume-bullet-marker']}`);
    expect(markerSpan).not.toBeNull();
    expect(markerSpan?.textContent).toBe('\u00A0');
    expect(rows[1]).toHaveTextContent('Built reliable workflows');
  });
});
