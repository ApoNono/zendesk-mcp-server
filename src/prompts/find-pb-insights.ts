import { Prompt, PromptArgument, PromptMessage } from '../core/types.js';

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
    const text = `# Find Productboard insights for Zendesk ticket ${ticketId}

You are joining support data (Zendesk) and product-feedback data (Productboard) to answer:
"What Productboard feedback is related to this support ticket?"

## Step 0 — Verify the Productboard MCP server is connected

Look at your available tool list. If you do **not** see tools beginning with \`pb_\` (e.g. \`pb_search_notes\`, \`pb_company_list\`), stop and tell the user:

> "This prompt requires the productboard-mcp-server to be connected alongside zendesk-mcp-server. Install it from https://github.com/miguelarios/productboard-mcp-server (or your fork) and add it to your MCP client config, then re-run this prompt."

Do not attempt to fulfil the request without Productboard tools available.

## Step 1 — Fetch the ticket with full context

Call \`zd_ticket_get\` with id=${ticketId}, include_context=true, include_comments=true.

From the response, extract:
- **requester_email** — the customer's email
- **email_domain** — extracted from requester_email (everything after @)
- **organization.name** — the customer's company name (if side-loaded)
- **3-5 topics** — the core themes of the ticket. Pull these from the subject, description, and comments. Examples: "slow exports", "SSO with Okta", "API rate limits". Be specific — "performance" is too broad; "export response time over 30s" is useful.

## Step 2 — Search Productboard with three strategies

Run all three of these in parallel (or sequentially if your client doesn't support parallel tool calls):

**A. This customer's direct feedback** (highest priority match):
   - Call \`pb_search_notes\` with a query that scopes to the customer's company name.
   - If pb_search_notes supports a company filter, use it. Otherwise include the company name in the query string.

**B. Topic-based feedback from anyone**:
   - For each topic from Step 1, call \`pb_search_notes\` with that topic as the query.
   - Capture the top 3-5 matches per topic.

**C. Email-domain fallback**:
   - If the org name match in (A) returned nothing, try \`pb_search_notes\` scoped by email_domain. This catches cases where Zendesk and Productboard have inconsistent company names.

## Step 3 — Apply the "narrow scope" rule

If the **total** count of unique notes returned across A + B + C is **greater than 20**:
- Do NOT dump them all on the user.
- Return the top 5 (prioritising customer-direct matches over topic matches).
- Then ask: "I found N total matches across customer-direct, topic, and domain searches. Want to narrow by a specific topic, time range, or feature area?"

If 20 or fewer, return all of them grouped by strategy.

## Step 4 — Synthesise the response

Output structured as:

\`\`\`
**Original support concern**
[1-sentence summary of what the customer is asking about]

**This customer's Productboard feedback**
[Notes filed by THIS customer in Productboard, with links. Or: "No direct feedback from this customer on file."]

**Related feedback from other customers**
[Top 3-5 notes matching the topics, with links and a 1-line description each]

**Suggested next action**
[One of: "Link this ticket to PB feature X", "Log new feedback in Productboard tied to feature Y", "No PB linkage needed — this is a support issue, not a product gap"]
\`\`\`

## Step 5 — If matching is weak

If across all three strategies you only find weak/keyword matches with low semantic relevance, say so explicitly: "I found some keyword matches but none are clearly related. The keyword search may be missing semantic matches — consider rephrasing the topics, or this may genuinely be unmatched in Productboard."

Begin with Step 0.`;

    return [{ role: 'user', content: { type: 'text', text } }];
  }
}
