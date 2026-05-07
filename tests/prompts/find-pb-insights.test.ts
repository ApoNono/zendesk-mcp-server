import { FindPBInsightsForTicketPrompt } from '../../src/prompts/find-pb-insights.js';

describe('FindPBInsightsForTicketPrompt', () => {
  const prompt = new FindPBInsightsForTicketPrompt();

  it('declares the cross-MCP dependency in its description', () => {
    expect(prompt.description.toLowerCase()).toMatch(/productboard/);
  });

  it('requires ticket_id', () => {
    expect(prompt.arguments?.[0]).toMatchObject({ name: 'ticket_id', required: true });
  });

  it('renders a single user-role message containing the ticket id', () => {
    const messages = prompt.render({ ticket_id: '4827' });
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content.type).toBe('text');
    expect(messages[0].content.text).toContain('4827');
  });

  it('instructs the LLM to verify productboard tools before proceeding', () => {
    const messages = prompt.render({ ticket_id: '1' });
    const text = messages[0].content.text;
    expect(text).toMatch(/pb_/);
    expect(text.toLowerCase()).toMatch(/verify|check|connected/);
  });

  it('includes the narrow-scope rule for large result sets', () => {
    const text = prompt.render({ ticket_id: '1' })[0].content.text;
    expect(text.toLowerCase()).toMatch(/narrow|refine/);
  });

  it('describes all three search strategies', () => {
    const text = prompt.render({ ticket_id: '1' })[0].content.text;
    expect(text.toLowerCase()).toMatch(/customer|company/);
    expect(text.toLowerCase()).toMatch(/topic/);
    expect(text.toLowerCase()).toMatch(/domain/);
  });
});
