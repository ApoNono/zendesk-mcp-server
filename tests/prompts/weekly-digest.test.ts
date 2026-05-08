import { WeeklySupportDigestPrompt } from '../../src/prompts/weekly-digest.js';

describe('WeeklySupportDigestPrompt', () => {
  const prompt = new WeeklySupportDigestPrompt();

  it('declares an optional window_days argument', () => {
    expect(prompt.arguments?.[0]).toMatchObject({ name: 'window_days' });
    expect(prompt.arguments?.[0].required).toBeFalsy();
  });

  it('defaults window to 7 days when not provided', () => {
    const text = prompt.render({})[0].content.text;
    expect(text).toContain('last 7 days');
  });

  it('substitutes provided window_days', () => {
    const text = prompt.render({ window_days: '14' })[0].content.text;
    expect(text).toContain('last 14 days');
  });

  it('mentions all three orchestrated angles (volume, quality, themes)', () => {
    const text = prompt.render({})[0].content.text.toLowerCase();
    expect(text).toMatch(/zd_tickets_count_by/);
    expect(text).toMatch(/zd_satisfaction_summary/);
    expect(text).toMatch(/zd_ticket_search/);
    expect(text).toMatch(/volume/);
    expect(text).toMatch(/quality|csat/);
    expect(text).toMatch(/theme/);
  });

  it('instructs to lead with concerning signals', () => {
    const text = prompt.render({})[0].content.text.toLowerCase();
    expect(text).toMatch(/lead with|top|concerning/);
  });
});
