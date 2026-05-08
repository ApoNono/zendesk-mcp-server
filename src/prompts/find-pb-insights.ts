import { Prompt, PromptArgument, PromptMessage } from '../core/types.js';

/**
 * A "hint" prompt rather than a script. Captures non-obvious workflow
 * knowledge (the email-domain fallback, the narrow-scope rule) and lets
 * the LLM handle ordering, output format, and synthesis.
 */
export class FindPBInsightsForTicketPrompt implements Prompt {
  public readonly name = 'find_pb_insights_for_ticket';
  public readonly description =
    'Given a Zendesk ticket ID, surface related Productboard feedback from the same customer and on the same topic. Requires productboard-mcp-server to be connected.';

  public readonly arguments: PromptArgument[] = [
    {
      name: 'ticket_id',
      description: 'The Zendesk ticket ID to investigate',
      required: true,
    },
  ];

  render(args: Record<string, string>): PromptMessage[] {
    const ticketId = args.ticket_id;
    const text = `For Zendesk ticket ${ticketId}, find related Productboard feedback.

Useful angles to explore:
- This specific customer's direct PB feedback. Try company name first; fall back to email domain if PB doesn't have an exact org-name match.
- Topic-level matches across all customers (broader product-feedback signal).
- Whether this customer has already filed PB feedback (suggest linking the ticket) vs not (suggest logging new feedback).

If the cumulative result set is large (>20 matches across angles), summarise counts and ask the user to narrow before dumping the full list.

If \`pb_*\` tools aren't connected, stop and tell the user to install productboard-mcp-server (https://github.com/miguelarios/productboard-mcp-server) and re-run.`;

    return [{ role: 'user', content: { type: 'text', text } }];
  }
}
